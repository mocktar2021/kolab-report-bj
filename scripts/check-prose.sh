#!/usr/bin/env sh
# Runs the write-like-mocktar checker on the given files (or "-" for stdin).
# Skips quietly when Python 3 is not installed.
command -v python3 >/dev/null 2>&1 || exit 0
exec python3 .claude/skills/write-like-mocktar/scripts/check_prose.py --errors-only "$@"
