#!/usr/bin/env bash
# Bumps apps/extension's version, runs prerelease checks, writes
# apps/extension/CHANGELOG.md, commits, and tags as extension-vX.Y.Z. The tag
# push triggers .github/workflows/publish-extension.yml, which zips the built
# dist/ and uploads to the Chrome Web Store.
#
# Usage:
#   bun run release:extension [patch|minor|major]
#
# Decoupled from the SDK release (sdk-v*) and dashboard release (v*).

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
  echo "error: release:extension must run from main (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi

require_green_ci

echo "→ running prerelease checks (lint, test:sdk, sdk:build)..."
bun run prerelease

echo "→ verifying extension unit tests + build..."
bun run ext:test
bun run ext:build

# Pin --from to the last extension-v* tag so changelogen doesn't pick up an
# unrelated sdk-v* or v* tag as its base. Bootstrap path: if no extension-v*
# tag exists yet, use HEAD~0 (empty compare range) so changelogen writes a
# fresh CHANGELOG section.
LAST_EXT_TAG=$(git tag --list 'extension-v*.*.*' --sort=-version:refname | head -n1)
if [ -z "$LAST_EXT_TAG" ]; then
  echo "→ no prior extension-v*.*.* tag; using initial commit as compare base"
  LAST_EXT_TAG=$(git rev-list --max-parents=0 HEAD | head -n1)
else
  echo "→ using $LAST_EXT_TAG as changelog base"
fi

CURRENT_VERSION=$(node -p "require('./apps/extension/package.json').version")
NEW_VERSION=$(node -e '
  const [M, m, pa] = process.argv[1].split(".").map(Number);
  const bump = process.argv[2];
  const next =
    bump === "major" ? [M + 1, 0, 0] :
    bump === "minor" ? [M, m + 1, 0] :
    [M, m, pa + 1];
  console.log(next.join("."));
' "$CURRENT_VERSION" "$BUMP")
TAG="extension-v${NEW_VERSION}"

echo "→ bumping @reprojs/extension $CURRENT_VERSION → $NEW_VERSION via changelogen..."
(
  cd apps/extension
  # --no-tag: changelogen hardcodes an unprefixed `git tag v${version}` that
  # collides with the dashboard's existing v*.*.* tags (e.g. an old v0.1.3)
  # and aborts the release. amend_release_commit_and_retag creates the real
  # `extension-v*` tag below, so the unprefixed one is pure collision risk.
  bunx changelogen --release \
    -r "$NEW_VERSION" \
    --from "$LAST_EXT_TAG" \
    --no-github \
    --no-tag
)

# The extension bundles @reprojs/core at build time, so changes to core's
# tree are functionally part of an extension release. Keep commits that
# touched the extension itself OR any of the SDK paths the bundle pulls in.
echo "→ filtering CHANGELOG to commits that touched extension or bundled SDK paths..."
filter_changelog_by_paths \
  apps/extension/CHANGELOG.md \
  "$LAST_EXT_TAG" \
  apps/extension packages/core packages/ui packages/sdk-utils packages/shared packages/recorder
amend_release_commit_and_retag "$TAG"

echo ""
echo "✓ tagged $TAG locally with scoped CHANGELOG entry."
echo ""
echo "Next: push to trigger publish-extension.yml"
echo "  git push --follow-tags"
echo ""
echo "(Push is intentionally manual — Chrome Web Store review is public-facing,"
echo " so review the tag before it ships.)"
