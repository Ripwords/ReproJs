#!/usr/bin/env bash
# Bumps packages/expo's version, runs prerelease checks, writes
# packages/expo/CHANGELOG.md, commits, and tags as expo-vX.Y.Z. The tag push
# triggers .github/workflows/publish-expo.yml, which republishes @reprojs/expo
# from source with provenance and creates the GitHub Release.
#
# Usage:
#   bun run release:expo [patch|minor|major]
#
# The Expo SDK is on its own release line separate from @reprojs/core (sdk-v*)
# and the dashboard (v*). Breaking changes in one don't force churn in the
# others.
#
# Bootstrap: before the very first release, `expo-v0.0.0` must exist as a
# base for changelogen's --from range. Cut it with:
#
#   git tag expo-v0.0.0 $(git rev-list --max-parents=0 HEAD)
#   git push origin expo-v0.0.0
#
# …then run this script.

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

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "error: release:expo must run from main (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi

require_green_ci

echo "→ running prerelease checks for the expo package (lint, tests, build)..."
bun run lint
bun --filter @reprojs/expo test
bun run expo:build

# changelogen's getLastGitTag returns the most recent reachable tag regardless
# of prefix — a recently-cut v*.*.* dashboard tag or sdk-v*.*.* tag would
# become the base and the compare range would be wrong. Pin --from to the
# most recent expo-v* tag.
LAST_EXPO_TAG=$(git tag --list 'expo-v*.*.*' --sort=-version:refname | head -n1)
if [ -z "$LAST_EXPO_TAG" ]; then
  echo "error: no expo-v*.*.* tag found to use as --from base." >&2
  echo "       Bootstrap by cutting expo-v0.0.0 first (see header of this script)." >&2
  exit 1
fi
echo "→ using $LAST_EXPO_TAG as changelog base"

# Compute the target version ourselves. changelogen silently downgrades bumps
# on 0.x versions (minor → patch, major → minor) — we want literal intent.
CURRENT_VERSION=$(node -p "require('./packages/expo/package.json').version")
NEW_VERSION=$(node -e '
  const [M, m, pa] = process.argv[1].split(".").map(Number);
  const bump = process.argv[2];
  const next =
    bump === "major" ? [M + 1, 0, 0] :
    bump === "minor" ? [M, m + 1, 0] :
    [M, m, pa + 1];
  console.log(next.join("."));
' "$CURRENT_VERSION" "$BUMP")
TAG="expo-v${NEW_VERSION}"

echo "→ bumping @reprojs/expo $CURRENT_VERSION → $NEW_VERSION via changelogen..."
(
  cd packages/expo
  # --no-tag: changelogen hardcodes an unprefixed `git tag v${version}` that
  # can collide with the dashboard's existing v*.*.* tags and abort the
  # release. amend_release_commit_and_retag creates the real `expo-v*` tag
  # below, so the unprefixed one is pure collision risk.
  bunx changelogen --release \
    -r "$NEW_VERSION" \
    --from "$LAST_EXPO_TAG" \
    --no-github \
    --no-tag
)

echo "→ filtering CHANGELOG to commits that touched @reprojs/expo paths..."
filter_changelog_by_paths \
  packages/expo/CHANGELOG.md \
  "$LAST_EXPO_TAG" \
  packages/expo packages/sdk-utils packages/shared packages/recorder
amend_release_commit_and_retag "$TAG"

echo ""
echo "✓ tagged $TAG locally with scoped CHANGELOG entry."
echo ""
echo "Next: push to trigger publish-expo.yml"
echo "  git push --follow-tags"
echo ""
echo "(Push is intentionally manual — npm publishes are immutable within"
echo " 72h, so review the tag before it ships.)"
