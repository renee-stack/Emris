#!/usr/bin/env bash
# Smoke test for the public API. Account-gated routes must refuse anonymous callers.
# Usage: BASE=http://localhost:3000 scripts/smoke.sh
set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0
TMP="$(mktemp)"
HDR="$(mktemp)"
trap 'rm -f "$TMP" "$HDR"' EXIT

# check <name> <expected status> <jq assertion> <curl args...>
check() {
  local name="$1" want="$2" assert="$3"
  shift 3
  local code
  code=$(curl -s -o "$TMP" -D "$HDR" -w '%{http_code}' --max-time 90 "$@")
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

GEOID=$(curl -s "$BASE/api/tracts" | jq -r '.features[0].properties.geoid')
ADDR=$(jq -r '.[0].address' data/permits.json)

echo "== /api/tracts"
check "tracts collection" 200 '.type == "FeatureCollection" and (.features | length > 0) and (.as_of | type == "string") and (has("top_permits") | not)' "$BASE/api/tracts"

echo "== /api/tract/[geoid] (anonymous)"
code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 90 "$BASE/api/tract/$GEOID?user_id=other-user&plan=pro")
if [[ "$code" == "200" ]] && jq -e --arg a "$ADDR" --arg g "$GEOID" \
  '.tract.geoid == $g and .top_permits == [] and .nearby_projects == [] and ([. | tostring] | .[0] | contains($a) | not)' \
  "$TMP" >/dev/null; then
  PASS=$((PASS + 1))
  echo "PASS  tract score without permit rows"
else
  FAIL=$((FAIL + 1))
  echo "FAIL  tract score without permit rows (status $code)"
  head -c 400 "$TMP"
  echo
fi
check "tract bad geoid -> 400" 400 '.error | type == "string"' "$BASE/api/tract/abc"
check "tract unknown -> 404" 404 '.error | type == "string"' "$BASE/api/tract/17031999999"

echo "== /api/near (anonymous)"
check "near requires a session" 401 '(.error | type == "string") and (has("permits") | not) and (has("projects") | not) and (has("place") | not)' \
  --get "$BASE/api/near" --data-urlencode "q=pilsen" --data-urlencode "plan=pro" --data-urlencode "user_id=00000000-0000-0000-0000-000000000001"
check "near missing q still requires a session" 401 '(has("permits") | not)' "$BASE/api/near"

echo "== /api/memo (anonymous)"
check "memo requires a session" 401 '(.error | type == "string") and (has("memo_markdown") | not)' \
  -X POST "$BASE/api/memo" -H 'Content-Type: application/json' \
  -d "{\"geoid\":\"$GEOID\",\"user_id\":\"other-user\",\"plan\":\"pro\"}"

echo "== /api/ask (anonymous)"
check "ask empty -> 400" 400 '(.error | type == "string") and (has("reply") | not)' \
  -X POST "$BASE/api/ask" -H 'Content-Type: application/json' -d '{"question":"  "}'
check "ask requires a session" 401 '(.error | type == "string") and (has("reply") | not) and (has("url") | not)' \
  -X POST "$BASE/api/ask" -H 'Content-Type: application/json' \
  -d '{"question":"what permits are near Pilsen","user_id":"other-user","plan":"pro"}'

echo "== account files and auth"
code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 20 "$BASE/permits.json")
if [[ "$code" == "404" ]]; then PASS=$((PASS + 1)); echo "PASS  permits.json 404"; else FAIL=$((FAIL + 1)); echo "FAIL  permits.json ($code)"; fi
code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 20 "$BASE/infrastructure.json")
if [[ "$code" == "404" ]]; then PASS=$((PASS + 1)); echo "PASS  infrastructure.json 404"; else FAIL=$((FAIL + 1)); echo "FAIL  infrastructure.json ($code)"; fi
code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 20 -X POST "$BASE/api/stripe/webhook" -H 'Content-Type: application/json' -d '{"type":"checkout.session.completed"}')
if [[ "$code" == "404" ]]; then PASS=$((PASS + 1)); echo "PASS  unsigned stripe webhook 404"; else FAIL=$((FAIL + 1)); echo "FAIL  stripe webhook ($code)"; fi
code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 20 -X POST "$BASE/api/auth/magic-link" -H 'Content-Type: application/json' -d '{"email":"ada@example.com","next":"https://evil.com","user_id":"other-user"}')
if [[ "$code" == "503" || "$code" == "400" ]] && ! grep -q 'ada@example.com' "$TMP"; then PASS=$((PASS + 1)); echo "PASS  magic link ($code, email not echoed)"; else FAIL=$((FAIL + 1)); echo "FAIL  magic link ($code)"; cat "$TMP"; fi
limited=0
for _ in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 20 -X POST "$BASE/api/auth/magic-link" -H 'Content-Type: application/json' -d '{"email":"ada@example.com","next":"https://evil.com"}')
  if [[ "$code" == "429" ]]; then limited=1; break; fi
done
if [[ "$limited" == "1" ]] && ! grep -q 'ada@example.com' "$TMP"; then PASS=$((PASS + 1)); echo "PASS  magic link rate limit"; else FAIL=$((FAIL + 1)); echo "FAIL  magic link rate limit ($code)"; fi
loc=$(curl -s -o /dev/null -D - --max-time 20 "$BASE/auth/callback?next=https://evil.com" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')
case "$loc" in
  "$BASE/map"|*/map) PASS=$((PASS + 1)); echo "PASS  callback next stays on /map ($loc)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL  callback open redirect ($loc)" ;;
esac
loc=$(curl -s -o /dev/null -D - --max-time 20 "$BASE/auth/callback?next=//evil.com" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')
case "$loc" in
  *evil.com*) FAIL=$((FAIL + 1)); echo "FAIL  callback protocol-relative ($loc)" ;;
  *) PASS=$((PASS + 1)); echo "PASS  callback protocol-relative blocked ($loc)" ;;
esac
final=$(curl -s --path-as-is -o /dev/null -w '%{url_effective}' -L --max-redirs 5 --max-time 20 "$BASE/landing//evil.com")
host=$(printf '%s' "$final" | sed -E 's#^[a-z]+://([^/]+).*#\1#')
base_host=$(printf '%s' "$BASE" | sed -E 's#^[a-z]+://([^/]+).*#\1#')
if [[ "$host" == "$base_host" && "$final" != *"://evil.com"* ]]; then PASS=$((PASS + 1)); echo "PASS  landing redirect stays on $host ($final)"; else FAIL=$((FAIL + 1)); echo "FAIL  landing open redirect ($final)"; fi
hdr=$(curl -s -D - -o /dev/null --max-time 20 "$BASE/map" | tr -d '\r')
for name in content-security-policy x-frame-options x-content-type-options referrer-policy permissions-policy; do
  if echo "$hdr" | grep -qi "^$name:"; then PASS=$((PASS + 1)); echo "PASS  header $name"; else FAIL=$((FAIL + 1)); echo "FAIL  header $name"; fi
done
if echo "$hdr" | grep -qi '^x-powered-by:'; then FAIL=$((FAIL + 1)); echo "FAIL  x-powered-by present"; else PASS=$((PASS + 1)); echo "PASS  no x-powered-by"; fi

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]]
