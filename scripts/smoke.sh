#!/usr/bin/env bash
# Smoke test for every API route. Usage: BASE=http://localhost:3000 scripts/smoke.sh
# Needs curl and jq; /api/memo and /api/ask need ANTHROPIC_API_KEY in .env.local.
set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# check <name> <expected status> <jq assertion> <curl args...>
check() {
  local name="$1" want="$2" assert="$3"
  shift 3
  local code
  code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 90 "$@")
  if [[ "$code" == "$want" ]] && jq -e "$assert" "$TMP" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL  $name (status $code, want $want; assert: $assert)"
    head -c 600 "$TMP"
    echo
  fi
}

ask() {
  local name="$1" question="$2" assert="$3"
  check "ask: $name" 200 "($assert) and (.reply | type == \"string\" and length > 0 and length < 600) and (.reply | test(\"https?://|\\\\*\\\\*|^#\") | not) and (.url | test(\"^/\\\\?(tract=[0-9]{11}|lat=-?[0-9.]+&lng=-?[0-9.]+&z=[0-9]+)$\"))" \
    -X POST "$BASE/api/ask" -H 'Content-Type: application/json' -d "$(jq -n --arg q "$question" '{question: $q}')"
  jq -r '"      reply: \(.reply)\n      url:   \(.url)"' "$TMP" 2>/dev/null
}

GEOID=$(curl -s "$BASE/api/tracts" | jq -r '.features[0].properties.geoid')

echo "== /api/tracts"
check "tracts collection" 200 '.type == "FeatureCollection" and (.features | length > 0) and (.as_of | type == "string")' "$BASE/api/tracts"

echo "== /api/tract/[geoid]"
check "tract detail" 200 ".tract.geoid == \"$GEOID\" and (.top_permits | length <= 10) and (.top_permits | all(.geoid == \"$GEOID\")) and (.nearby_projects | all(.distance_mi <= 1))" "$BASE/api/tract/$GEOID"
check "tract permits newest first" 200 '[.top_permits[].issue_date] == ([.top_permits[].issue_date] | sort | reverse)' "$BASE/api/tract/$GEOID"
check "tract bad geoid -> 400" 400 '.error | type == "string"' "$BASE/api/tract/abc"
check "tract unknown -> 404" 404 '.error | type == "string"' "$BASE/api/tract/17031999999"

echo "== /api/near"
check "near Pilsen (neighborhood)" 200 '.place.label == "Pilsen, Chicago" and (.permits | type == "array") and (.projects | all(.distance_mi <= 1))' --get "$BASE/api/near" --data-urlencode "q=pilsen" --data-urlencode "radius_mi=1"
check "near Logan Square finds a tract" 200 '.tract != null and (.permits | length <= 25)' --get "$BASE/api/near" --data-urlencode "q=Logan Square"
check "near address (Census geocoder)" 200 '(.place.lat | . > 41.6 and . < 42.1) and (.place.lng | . < -87.5)' --get "$BASE/api/near" --data-urlencode "q=1500 N Milwaukee Ave"
check "near radius clamps" 200 '(.projects | all(.distance_mi <= 2))' --get "$BASE/api/near" --data-urlencode "q=West Loop" --data-urlencode "radius_mi=99"
check "near missing q -> 400" 400 '.error | type == "string"' "$BASE/api/near"
check "near nowhere -> 404" 404 '.error | type == "string"' --get "$BASE/api/near" --data-urlencode "q=zzzz qqqq nowhere 99999"

echo "== /api/memo"
check "memo bad geoid -> 400" 400 '.error | type == "string"' -X POST "$BASE/api/memo" -H 'Content-Type: application/json' -d '{"geoid":"12"}'
check "memo unknown -> 404" 404 '.error | type == "string"' -X POST "$BASE/api/memo" -H 'Content-Type: application/json' -d '{"geoid":"17031999999"}'
check "memo" 200 ".geoid == \"$GEOID\" and (.title | endswith(\"Path of Progress Memo\")) and (.memo_markdown as \$m | [\"## Thesis\",\"## What the permits show\",\"## Infrastructure catalysts\",\"## Momentum\",\"## Risks and gaps in the data\",\"## Suggested next diligence steps\"] | all(. as \$h | \$m | contains(\$h)))" \
  -X POST "$BASE/api/memo" -H 'Content-Type: application/json' -d "{\"geoid\":\"$GEOID\"}"

echo "== /api/ask"
check "ask empty -> 400" 400 '.error | type == "string"' -X POST "$BASE/api/ask" -H 'Content-Type: application/json' -d '{"question":"  "}'
ask "address" "what permits have recently been filed near 1500 N Milwaukee Ave" '.url | startswith("/?")'
ask "off-topic zoning" "what are the zoning requirements in Lincoln Park" '.reply | test("(?i)don.t have")'
ask "neighborhood" "what's happening in Pilsen" '.url | startswith("/?")'
ask "top 5" "top 5 tracts" '.url | startswith("/?tract=")'
ask "named tract" "tell me about Bronzeville tract 3511" '.url == "/?tract=17031351100"'
ask "south side" "where is multifamily heating up on the south side?" '.url | startswith("/?")'
ask "help" "hi, what can you do?" '.url | startswith("/?")'

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
