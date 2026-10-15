#!/bin/sh
# Tells .github/workflows/ci.yml whether a change touches more than the
# documentation (KRB-190). Prints code=true or code=false, for $GITHUB_OUTPUT.
# Documentation is docs/ and Markdown files: a change made only of those skips
# the end-to-end and Lighthouse jobs. When it cannot tell (a manual run, a new
# branch, a push whose previous commit is gone), it prints code=true and
# everything runs.
#
#   EVENT=pull_request sh scripts/ci-changed-code.sh   (on the PR merge commit)
#   EVENT=push BEFORE=<sha> sh scripts/ci-changed-code.sh
set -eu

everything() {
  echo "$1, so every job runs." >&2
  echo "code=true"
  exit 0
}

case "${EVENT:-}" in
  pull_request)
    # actions/checkout gives the PR merged into its base: the first parent is
    # the base, so the diff is what the PR changes.
    base=HEAD^1
    git cat-file -e "$base^{commit}" 2>/dev/null || everything "No base commit in the checkout"
    ;;
  push)
    base=${BEFORE:-}
    case "$base" in
      "" | *[!0]*) ;;
      *) everything "New branch" ;;
    esac
    [ -n "$base" ] || everything "No previous commit"
    if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
      git fetch --quiet --no-tags --depth=1 origin "$base" 2>/dev/null ||
        everything "Previous commit $base not found"
    fi
    ;;
  *)
    everything "Event ${EVENT:-unknown}"
    ;;
esac

# --no-renames lists a moved file at both paths, so moving code into docs/
# still counts as a code change.
files=$(git diff --no-renames --name-only "$base" HEAD)
code=$(printf '%s\n' "$files" | grep -vE '^docs/|\.md$' | grep -c . || true)

echo "Changed files:" >&2
printf '%s\n' "$files" | sed 's/^/  /' >&2
if [ "$code" -gt 0 ]; then
  echo "$code file(s) outside the documentation." >&2
  echo "code=true"
else
  echo "Nothing outside the documentation: the end-to-end and Lighthouse jobs are skipped." >&2
  echo "code=false"
fi
