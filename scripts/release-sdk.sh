#!/usr/bin/env bash
# Bumps packages/core's version, runs prerelease checks, writes
# packages/core/CHANGELOG.md, commits, and tags as sdk-vX.Y.Z. The tag push
# triggers .github/workflows/publish-npm.yml, which republishes @reprojs/core
# from source with provenance and creates the GitHub Release.
#
# Usage:
#   bun run release:sdk [patch|minor|major]
#
# The SDK release is intentionally decoupled from the dashboard release
# (which uses `bun run release:minor` and v*.*.* tags), so a dashboard-only
# change doesn't force a churn republish of the SDK.
#
# Why delegate to changelogen instead of bumping package.json in the shell:
#   - Generates packages/core/CHANGELOG.md so the npm-side release line has
#     its own changelog, independent of the dashboard's root CHANGELOG.md.
#   - Produces the release notes that publish-npm.yml pastes into the GH
#     Release, so consumers get a real changelog on every tag.

set -euo pipefail

# shellcheck source=lib/ci-gate.sh
. "$(dirname "$0")/lib/ci-gate.sh"
# shellcheck source=lib/scope-changelog.sh
. "$(dirname "$0")/lib/scope-changelog.sh"

BUMP="${1:-patch}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "usage: $0 [patch|minor|major]" >&2; exit 2 ;;
esac

# Refuse to release from a dirty working tree — changelogen commits whatever
# is staged, and we only want the version bump + changelog update in the
# release commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "error: release:sdk must run from main (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi

require_green_ci

echo "→ running prerelease checks (lint, test:sdk, sdk:build)..."
bun run prerelease

# changelogen's getLastGitTag uses `git describe --tags --abbrev=0`, which
# returns the most recent reachable tag regardless of prefix. Without an
# explicit --from, a recently-cut v*.*.* dashboard tag would become the SDK
# changelog's base and the compare range would be wrong. Pin --from to the
# last sdk-v* tag.
LAST_SDK_TAG=$(git tag --list 'sdk-v*.*.*' --sort=-version:refname | head -n1)
if [ -z "$LAST_SDK_TAG" ]; then
  echo "error: no sdk-v*.*.* tag found to use as --from base" >&2
  exit 1
fi
echo "→ using $LAST_SDK_TAG as changelog base"

# Compute the target version ourselves instead of letting changelogen's
# `--patch/--minor/--major` decide. changelogen silently downgrades bumps
# while on 0.x versions (minor → patch, major → minor), which would change
# this script's existing behavior where `release:sdk minor` means a real
# minor bump. Pass -r <version> so the intent is literal.
CURRENT_VERSION=$(node -p "require('./packages/core/package.json').version")
NEW_VERSION=$(node -e '
  const [M, m, pa] = process.argv[1].split(".").map(Number);
  const bump = process.argv[2];
  const next =
    bump === "major" ? [M + 1, 0, 0] :
    bump === "minor" ? [M, m + 1, 0] :
    [M, m, pa + 1];
  console.log(next.join("."));
' "$CURRENT_VERSION" "$BUMP")
TAG="sdk-v${NEW_VERSION}"

echo "→ bumping @reprojs/core $CURRENT_VERSION → $NEW_VERSION via changelogen..."
# --no-github: changelogen's GitHub Release sync hardcodes `v${version}` as
# the tag name, which wouldn't match our `sdk-v*` tag. publish-npm.yml
# creates the GH Release itself after npm publish succeeds.
# --no-tag: changelogen also creates a local `git tag v${version}` (hardcoded,
# unprefixed). Once the dashboard's v*.*.* line reaches the SDK's numbering
# (e.g. an old dashboard v0.4.1 already exists), that `git tag v0.4.1` collides
# and aborts the release mid-run. We don't want the unprefixed tag anyway —
# amend_release_commit_and_retag below creates the real `sdk-v*` tag.
(
  cd packages/core
  bunx changelogen --release \
    -r "$NEW_VERSION" \
    --from "$LAST_SDK_TAG" \
    --no-github \
    --no-tag
)

# changelogen has no path filter — without this, packages/core/CHANGELOG.md
# inherits every commit since the last sdk-v* tag, including dashboard-only
# and unrelated work. Filter to only commits that touched the paths bundled
# into @reprojs/core. Then amend the release commit + move the tag forward
# so the upstream content matches the file.
echo "→ filtering CHANGELOG to commits that touched @reprojs/core paths..."
filter_changelog_by_paths \
  packages/core/CHANGELOG.md \
  "$LAST_SDK_TAG" \
  packages/core packages/ui packages/sdk-utils packages/shared packages/recorder
amend_release_commit_and_retag "$TAG"

echo ""
echo "✓ tagged $TAG locally with scoped CHANGELOG entry."
echo ""
echo "Next: push to trigger publish-npm.yml"
echo "  git push --follow-tags"
echo ""
echo "(Push is intentionally manual — npm publishes are immutable within"
echo " 72h, so review the tag before it ships.)"
