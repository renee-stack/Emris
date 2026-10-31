#!/usr/bin/env bash
# Fails if a specific place name appears in code. Place names belong only in
# places/ (configs), tests/fixtures/ (sample rows), docs/ and legacy/.
# Usage: scripts/check_place_names.sh   (run from anywhere inside the repo)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Whole-word, case-insensitive. Add names here as new places are loaded.
PATTERN='\b(chicago|cook|illinois|dupage|lake county|will county|kane|mchenry)\b'

# Tracked files only, minus allowed folders and this script (which has to name them).
files=$(git ls-files -- . \
  ':(exclude)places/**' ':(exclude)tests/fixtures/**' ':(exclude)docs/**' ':(exclude)legacy/**' \
  ':(exclude)scripts/check_place_names.sh' ':(exclude)**/package-lock.json')

[ -z "$files" ] && { echo "check_place_names: no files to scan"; exit 0; }

# -I skips binary files. xargs keeps paths with spaces and parentheses intact.
if hits=$(printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 grep -InHiE "$PATTERN" 2>/dev/null); then
  echo "Place names found outside places/, tests/fixtures/, docs/ and legacy/:"
  echo "$hits"
  echo
  echo "$(printf '%s\n' "$hits" | wc -l | tr -d ' ') hit(s) in $(printf '%s\n' "$hits" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') file(s). Move the value into a place config."
  exit 1
fi
echo "check_place_names: OK"
