#!/usr/bin/env bash
# Filter a CHANGELOG.md (just-written by `changelogen --release`) so it only
# includes commits that touched a given set of paths. changelogen has no
# native path filter — without this, packages/core/CHANGELOG.md, packages/expo/
# CHANGELOG.md, and apps/extension/CHANGELOG.md all end up with EVERY commit
# in the range, including dashboard-only and unrelated work.
#
# Usage (in a release script, AFTER `bunx changelogen --release`):
#
#   . "$(dirname "$0")/lib/scope-changelog.sh"
#   filter_changelog_by_paths \
#     packages/core/CHANGELOG.md \
#     "$LAST_SDK_TAG" \
#     packages/core packages/ui packages/sdk-utils packages/shared packages/recorder
#
# The first arg is the CHANGELOG path. The second is the changelog base
# (the previous tag for this package's release line). Remaining args are
# git pathspecs — any commit that touched at least one of these is kept.
#
# Lines without a commit reference (section headers, separators, etc.) pass
# through unchanged.

filter_changelog_by_paths() {
  local CHANGELOG="$1"; shift
  local FROM="$1"; shift
  # Remaining positional args are paths.

  if [ ! -f "$CHANGELOG" ]; then
    echo "filter_changelog_by_paths: $CHANGELOG does not exist" >&2
    return 1
  fi

  # Build the set of short SHAs whose commits touched the requested paths
  # into a tempfile (one per line). awk reads it via getline because
  # passing newline-bearing strings via -v is non-portable across awk
  # implementations.
  local sha_file
  sha_file=$(mktemp)
  git log --pretty=format:'%h' "${FROM}..HEAD" -- "$@" | sort -u > "$sha_file"

  # awk filter: each line either has a [shorthash] commit ref OR doesn't.
  # If it has one, keep the line iff the SHA is in our kept set. Lines
  # without a ref (headers, blanks, "compare changes" links) pass through.
  awk -v sha_file="$sha_file" '
    BEGIN {
      while ((getline line < sha_file) > 0) keep[line] = 1
      close(sha_file)
    }
    {
      if (match($0, /\[[a-f0-9]{7,12}\]/) > 0) {
        sha = substr($0, RSTART + 1, RLENGTH - 2)
        if (!(sha in keep)) next
      }
      print
    }
  ' "$CHANGELOG" > "${CHANGELOG}.tmp"
  mv "${CHANGELOG}.tmp" "$CHANGELOG"
  rm -f "$sha_file"
}
# NOTE: amend_release_commit_and_retag() used to live here. It amended
# changelogen's commit and re-tagged with `git tag -f` — a LIGHTWEIGHT tag.
# Every release script then told you to run `git push --follow-tags`, which
# pushes annotated tags only, so those pushes silently no-op'd: no tag on the
# remote, no publish workflow, no error. release.sh now passes --no-commit
# --no-tag to changelogen and creates annotated tags itself, so there's
# nothing to amend.
