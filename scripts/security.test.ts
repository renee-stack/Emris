import assert from "node:assert/strict";
import test from "node:test";
import { appOrigin } from "../lib/http/origin.ts";
import { redactTract } from "../lib/auth/redact.ts";
import { clientIp, take } from "../lib/ratelimit.ts";
import { sessionCookieOptions } from "../lib/supabase/cookies.ts";
import { landingDestination, safeMapPath } from "../lib/supabase/return-path.ts";

const detail = {
  tract: {
    geoid: "17031221500",
    name: "Logan Square · Tract 2215",
    score: 87,
    percentile: 84,
    momentum: "up",
    momentum_pct: 50,
    signals: { mf_permits: 92, permit_momentum: 75, infra_proximity: 60 },
    permit_count_24mo: 4,
    units_24mo: 210,
  },
  top_permits: [
    {
      id: "100",
      address: "2318 N Kedzie Ave",
      lat: 41.9,
      lng: -87.7,
      issue_date: "2026-03-14",
      units: 48,
      description: "Erect a 6-story building",
      geoid: "17031221500",
    },
  ],
  nearby_projects: [
    {
      id: "p1",
      name: "Kedzie station",
      type: "transit",
      status: "planned",
      lat: 41.9,
      lng: -87.7,
      budget_usd: 1000,
      expected_completion: null,
      description: "A station",
      source_url: "https://example.com/secret-source",
      distance_mi: 0.2,
    },
  ],
};

test("anonymous tract detail drops permit and project fields", () => {
  const body = JSON.stringify(redactTract(detail, false));
  const parsed = JSON.parse(body);
  assert.equal(parsed.tract.score, 87);
  assert.equal(parsed.top_permits.length, 0);
  assert.equal(parsed.nearby_projects.length, 0);
  assert.equal(body.includes("2318 N Kedzie Ave"), false);
  assert.equal(body.includes("Kedzie station"), false);
  assert.equal(body.includes("secret-source"), false);
  assert.equal(body.includes("1000"), false);
});

test("signed-in tract detail keeps account fields", () => {
  const kept = redactTract(detail, true);
  assert.equal(kept.top_permits[0].address, "2318 N Kedzie Ave");
  assert.equal(kept.nearby_projects[0].source_url, "https://example.com/secret-source");
});

test("auth return paths stay on this origin", () => {
  const origin = "http://localhost:3000";
  for (const next of [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "///evil.com",
    "/map/../../etc",
    "http://evil.com/map",
    "/account",
  ]) {
    const path = safeMapPath(next, origin);
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/map");
    assert.equal(url.href.includes("evil.com"), false);
  }
  assert.equal(
    safeMapPath("/map?place=austin&tract=17031221500&next=https://evil.com", origin),
    "/map?place=austin&tract=17031221500",
  );
});

test("landing redirects cannot leave the origin", () => {
  for (const pathname of [
    "/landing//evil.com",
    "/landing/https://evil.com",
    "/landing/%2F%2Fevil.com",
    "/landing/\\evil.com",
  ]) {
    const dest = landingDestination(new URL(`http://localhost:3000${pathname}`));
    assert.ok(dest);
    assert.equal(dest.origin, "http://localhost:3000");
    assert.equal(dest.href.includes("evil.com"), false);
  }
  const kept = landingDestination(new URL("http://localhost:3000/landing/map"));
  assert.equal(kept?.pathname, "/map");
});

test("app origin ignores a foreign host header when a base URL is set", () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://emris.example";
  try {
    const origin = appOrigin(new Request("http://evil.com/auth/callback"));
    assert.equal(origin, "https://emris.example");
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});

test("session cookies are not readable by scripts", () => {
  const options = sessionCookieOptions({ httpOnly: false, sameSite: "none", secure: false });
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
});

test("rate limit resets and does not trust a spoofed forwarded header", () => {
  const first = take("test-bucket", 2, 1_000, 1_000);
  const second = take("test-bucket", 2, 1_000, 1_001);
  const third = take("test-bucket", 2, 1_000, 1_002);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.resetAt, first.resetAt);

  const req = new Request("http://localhost/api/near", {
    headers: { "x-forwarded-for": "1.2.3.4, 8.8.8.8", "x-real-ip": "9.9.9.9" },
  });
  assert.equal(clientIp(req), "9.9.9.9");
  const forwarded = new Request("http://localhost/api/near", {
    headers: { "x-forwarded-for": "1.2.3.4, 8.8.8.8" },
  });
  assert.equal(clientIp(forwarded), "8.8.8.8");
});
