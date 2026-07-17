#!/usr/bin/env bash
# One command to release every artifact affected by what's on main.
#
#   bun run release                  # patch every affected artifact
#   bun run release --minor          # level applies to all affected
#   bun run release --dry-run        # print the plan, touch nothing
#   bun run release --only sdk       # restrict to these (comma-separated)
#   bun run release --skip extension # inverse of --only
#   bun run release --yes            # skip the confirm prompt
#
# Replaces release-{sdk,dashboard,extension,expo}.sh, which were four
# near-identical scripts. Releasing one bugfix that reached three artifacts
# meant three commands, three pushes, and three full CI cycles — because each
# release commit moved HEAD, and every script re-gated on green CI for the new
# HEAD. This does the whole set in one commit, one CI gate, one prompt.
#
# Mixed bump levels aren't expressible in a single run by design; compose with
# --only instead:
#   bun run release --minor --only sdk
#   bun run release --only dashboard,extension
#
# Version lines stay independent per artifact (sdk-v0.4.2 / v0.6.5 /
# extension-v0.1.4), so a dashboard-only change still can't churn a republish
# of @reprojs/core to npm.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=lib/ci-gate.sh
. "$(dirname "$0")/lib/ci-gate.sh"
# shellcheck source=lib/scope-changelog.sh
. "$(dirname "$0")/lib/scope-changelog.sh"

# Everything bundled into the SDK IIFE. The dashboard bakes that bundle into
# its image (Dockerfile) and the extension syncs it at build time
# (apps/extension/scripts/sync-sdk.ts), so a change to any of these has to
# reach all three — which is exactly what got missed when a packages/ui CSP
# fix shipped to npm while the dashboard and extension kept serving the old
# bundle.
SDK_SRC="packages/core packages/ui packages/sdk-utils packages/shared packages/recorder"

# name | version dir | tag prefix | own paths | bundled-dependency paths
#
# "Affected" = any commit since this artifact's last tag touched (own +
# bundled) paths. Propagation needs no special-casing: it falls out of listing
# what each artifact is actually built from. Note expo deliberately does NOT
# list packages/ui — it ships its own React Native UI and never bundles the
# web widget.
artifact_rows() {
  cat <<EOF
sdk|packages/core|sdk-v|$SDK_SRC|
dashboard|.|v|apps/dashboard packages/integrations|$SDK_SRC
extension|apps/extension|extension-v|apps/extension|$SDK_SRC
expo|packages/expo|expo-v|packages/expo packages/sdk-utils packages/shared|
EOF
}

publish_target() {
  case "$1" in
    sdk) echo "npm (@reprojs/core)" ;;
    dashboard) echo "Docker Hub image" ;;
    extension) echo "Chrome Web Store (public review)" ;;
    expo) echo "npm (@reprojs/expo)" ;;
  esac
}

BUMP="patch"
DRY_RUN=0
ASSUME_YES=0
ONLY=""
SKIP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --patch) BUMP="patch" ;;
    --minor) BUMP="minor" ;;
    --major) BUMP="major" ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --only) ONLY="$2"; shift ;;
    --skip) SKIP="$2"; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

in_csv() {
  case ",$2," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

pkg_json_for() {
  if [ "$1" = "." ]; then echo "package.json"; else echo "$1/package.json"; fi
}

changelog_for() {
  if [ "$1" = "." ]; then echo "CHANGELOG.md"; else echo "$1/CHANGELOG.md"; fi
}

# Compute the next version ourselves rather than using changelogen's
# --patch/--minor/--major: those silently downgrade while on 0.x (minor →
# patch, major → minor), so `--minor` would quietly not be a minor. Passing an
# explicit -r makes the intent literal.
next_version() {
  node -e '
    const [M, m, pa] = process.argv[1].split(".").map(Number);
    const bump = process.argv[2];
    const next =
      bump === "major" ? [M + 1, 0, 0] :
      bump === "minor" ? [M, m + 1, 0] :
      [M, m, pa + 1];
    console.log(next.join("."));
  ' "$1" "$2"
}

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "error: release must run from main (currently on $(git rev-parse --abbrev-ref HEAD))" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

# --- Work out what's affected ------------------------------------------------

PLAN=""   # name|dir|tag|new_version|reason
COUNT=0

while IFS='|' read -r NAME DIR PREFIX OWN DEPS; do
  [ -z "$NAME" ] && continue
  if [ -n "$ONLY" ] && ! in_csv "$NAME" "$ONLY"; then continue; fi
  if [ -n "$SKIP" ] && in_csv "$NAME" "$SKIP"; then continue; fi

  LAST_TAG=$(git tag --list "${PREFIX}*.*.*" --sort=-version:refname | head -n1)
  if [ -z "$LAST_TAG" ]; then
    echo "warning: no ${PREFIX}*.*.* tag found — skipping $NAME" >&2
    continue
  fi

  # Two things get discounted, or a release makes the next one look necessary:
  #
  # 1. Release commits (--invert-grep). A release bumps its own package.json,
  #    which lives inside the artifact's own paths, so a plain diff counts
  #    "chore(release): sdk-v0.4.2" as an SDK change and marks everything that
  #    bundles core affected — forever.
  # 2. CHANGELOG.md (:(exclude)). It's a release artifact, not source. Editing
  #    one is never a reason to ship a package. A changelog-only commit that
  #    wasn't a release commit — restoring eroded history, say — otherwise
  #    reads as a source change to core and would publish a new SDK to npm,
  #    rebuild the image, and push the extension into Web Store review with no
  #    code change behind any of it.
  #
  # Neither can hide real work: nothing but a release writes a version bump,
  # and no source lives in a CHANGELOG.
  EXCL=':(exclude)*CHANGELOG.md'
  # shellcheck disable=SC2086 # word splitting is how the pathspecs are passed
  OWN_CHANGED=$(git log --format=%h --invert-grep --grep='^chore(release):' "${LAST_TAG}..HEAD" -- $OWN "$EXCL")
  DEP_CHANGED=""
  if [ -n "$DEPS" ]; then
    # shellcheck disable=SC2086
    DEP_CHANGED=$(git log --format=%h --invert-grep --grep='^chore(release):' "${LAST_TAG}..HEAD" -- $DEPS "$EXCL")
  fi
  [ -z "$OWN_CHANGED$DEP_CHANGED" ] && continue

  if [ -n "$OWN_CHANGED" ]; then REASON="own changes"; else REASON="bundles @reprojs/core"; fi

  CURRENT=$(node -p "require('./$(pkg_json_for "$DIR")').version")
  NEW=$(next_version "$CURRENT" "$BUMP")
  PLAN="${PLAN}${NAME}|${DIR}|${PREFIX}${NEW}|${NEW}|${CURRENT}|${REASON}|${LAST_TAG}|${OWN} ${DEPS}
"
  COUNT=$((COUNT + 1))
done <<EOF
$(artifact_rows)
EOF

if [ "$COUNT" -eq 0 ]; then
  echo "Nothing to release — no artifact has changes since its last tag."
  exit 0
fi

# --- Show the plan -----------------------------------------------------------

echo ""
if [ "$DRY_RUN" -eq 1 ]; then echo "→ would release ($BUMP):"; else echo "→ affected since last tags ($BUMP):"; fi
echo ""
printf '%s' "$PLAN" | while IFS='|' read -r NAME DIR TAG NEW CURRENT REASON LAST_TAG PATHS; do
  [ -z "$NAME" ] && continue
  printf '    %-12s %-8s → %-8s → %-18s → %s\n' \
    "$NAME" "$CURRENT" "$NEW" "$TAG" "$(publish_target "$NAME")"
  printf '    %-12s %s\n' "" "($REASON, since $LAST_TAG)"
done
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (dry run — nothing committed, tagged or pushed)"
  exit 0
fi

require_green_ci

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "  Commit, tag and push all of the above? [y/N] "
  read -r REPLY < /dev/tty
  case "$REPLY" in
    [yY]) ;;
    *) echo "aborted."; exit 1 ;;
  esac
fi

# --- Verify ------------------------------------------------------------------
#
# Run explicitly rather than via bun's implicit pre/post script hooks. The old
# setup had a "postrelease": "git push --follow-tags" that fired automatically
# and pushed the dashboard release, while the script itself printed "Next:
# push" — so the same command auto-pushed one artifact and not the others. Both
# hooks are gone; everything this command does is in this file.

echo "→ verifying (check, sdk:build, test:sdk)..."
bun run check
bun run sdk:build
bun run test:sdk

if printf '%s' "$PLAN" | grep -q '^extension|'; then
  echo "→ verifying extension..."
  bun run ext:test
  bun run ext:build
fi
if printf '%s' "$PLAN" | grep -q '^expo|'; then
  echo "→ verifying expo..."
  bun run expo:build
fi

# --- Bump + changelog (no commit, no tag — we batch those) --------------------

TAGS=""
while IFS='|' read -r NAME DIR TAG NEW CURRENT REASON LAST_TAG PATHS; do
  [ -z "$NAME" ] && continue
  echo "→ $NAME $CURRENT → $NEW"
  (
    cd "$DIR"
    # --no-commit/--no-tag: changelogen would otherwise create one commit and
    # one tag per artifact. We want a single commit carrying every bump, with
    # all tags pointing at it.
    # --no-github: publish-*.yml own GitHub Release creation; changelogen
    # hardcodes an unprefixed `v${version}` tag name and can't be told about
    # the sdk-/extension-/expo- prefixes.
    bunx changelogen --release \
      -r "$NEW" \
      --from "$LAST_TAG" \
      --no-commit \
      --no-tag \
      --no-github >/dev/null
  )
  # changelogen has no path filter, so every artifact's CHANGELOG would
  # otherwise inherit every commit in the range, dashboard-only work included.
  # shellcheck disable=SC2086
  filter_changelog_by_paths "$(changelog_for "$DIR")" "$LAST_TAG" $PATHS
  git add "$(pkg_json_for "$DIR")" "$(changelog_for "$DIR")"
  TAGS="$TAGS $TAG"
done <<EOF
$(printf '%s' "$PLAN")
EOF

# --- One commit, annotated tags, one push ------------------------------------

SUMMARY=$(printf '%s' "$TAGS" | sed 's/^ //; s/ /, /g')
git commit -q -m "chore(release): $SUMMARY"

# Annotated (-a), NOT lightweight. `git push --follow-tags` — which every
# release script used to print as the next step — pushes annotated tags only.
# The old helper re-tagged with `git tag -f` (lightweight), so those pushes
# silently no-op'd: the tag never reached the remote and the publish workflow
# never fired, with nothing reporting a failure.
for TAG in $TAGS; do
  git tag -a "$TAG" -m "$TAG"
done

echo "→ pushing main..."
git push origin main

# Pushed one at a time on purpose: GitHub does not start workflow runs for
# tags beyond the third in a single push, and there are four artifacts. One
# push per tag keeps every publish workflow firing regardless of set size.
for TAG in $TAGS; do
  echo "→ pushing $TAG..."
  git push origin "$TAG"
done

echo ""
echo "✓ released:$TAGS"
echo ""
echo "Publish workflows are running. Track them with:"
echo "  gh run list --limit 5"
