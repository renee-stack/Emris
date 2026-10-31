import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.TEST_PORT || 3456);
const base = `http://127.0.0.1:${port}`;
const webhookSecret = "whsec_test_emris";
const day = 24 * 60 * 60 * 1000;

let child;
let log = "";
let busy = "";
let other = "";
let fullRows = [];

function user(id, extra = {}) {
  return {
    id,
    entitlements: [],
    subscription: null,
    searches_used: 0,
    alerts_used: 0,
    ...extra,
  };
}

function paid(plan, role) {
  return user(`user-${plan}${role ? `-${role}` : ""}`, {
    searches_used: 99,
    alerts_used: 99,
    seats_used: role === "owner" ? 2 : undefined,
    subscription: {
      plan,
      status: "active",
      role: role ?? null,
      seat_limit: plan === "team" ? 5 : null,
    },
  });
}

async function api(pathname, { who, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(who ? { "x-emris-user": JSON.stringify(who) } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function sections(markdown) {
  return String(markdown ?? "")
    .split("\n")
    .filter((line) => line.startsWith("## ")).length;
}

function hiddenIds() {
  return fullRows.slice(1).map((row) => row.permit_id);
}

function assertPreviewList(list) {
  assert.equal(list.count, fullRows.length);
  assert.equal(list.rows.length, 1);
  assert.equal(list.locked, true);
  assert.equal(list.rows[0].permit_id, fullRows[0].permit_id);
  const present = new Set(list.rows.map((row) => row.permit_id));
  for (const id of hiddenIds()) assert.equal(present.has(id), false);
}

function assertFullList(list) {
  assert.equal(list.locked, false);
  assert.equal(list.count, fullRows.length);
  assert.equal(list.rows.length, fullRows.length);
  assert.deepEqual(
    list.rows.map((row) => row.permit_id),
    fullRows.map((row) => row.permit_id),
  );
}

async function expectSubscription(who, kind) {
  const me = await api("/api/me", { who });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.plan, kind);
  assert.equal(me.json.paid, true);
  assert.equal(me.json.rehab_names, true);
  assert.equal(me.json.export, true);
  assert.equal(me.json.search.allowed, true);
  assert.equal(me.json.search.limit, null);
  assert.equal(me.json.alerts.allowed, true);
  assert.equal(me.json.alerts.limit, null);

  const near = await api("/api/near?q=Pilsen", { who });
  assert.equal(near.status, 200, near.text);
  assert.equal(near.json.usage.limit, null);
  assert.ok(Array.isArray(near.json.permits));

  const tract = await api(`/api/tract/${busy}`, { who });
  assert.equal(tract.status, 200, tract.text);
  assert.equal(typeof tract.json.tract.score, "number");
  assert.ok(tract.json.top_permits.length > 1);
  assert.equal(tract.json.wayback.available, true);
  assert.ok(Array.isArray(tract.json.nearby_projects));
  assertFullList(tract.json.rehab);

  const rehab = await api(`/api/rehab?geoid=${busy}`, { who });
  assert.equal(rehab.status, 200, rehab.text);
  assertFullList(rehab.json);

  const memo = await api("/api/memo", { method: "POST", who, body: { geoid: busy } });
  assert.equal(memo.status, 200, memo.text);
  assert.equal(memo.json.access, "full");
  assert.equal(sections(memo.json.memo_markdown), 5);

  for (const target of [busy, other]) {
    const report = await api("/api/report", {
      method: "POST",
      who,
      body: { report_type: "area", target_id: target },
    });
    assert.equal(report.status, 200, report.text);
    assert.equal(report.json.report.rehab.rows.length, report.json.report.rehab.count);
    const exported = await api(`/api/export?report_type=area&target_id=${target}`, { who });
    assert.equal(exported.status, 200, exported.text);
    assert.equal(exported.json.rows.length, exported.json.count);
  }

  const alerts = await api("/api/alerts", { method: "POST", who, body: { area_id: "tract-1" } });
  assert.equal(alerts.status, 200, alerts.text);
}

async function expectFree(who, { kind, searches }) {
  const me = await api("/api/me", { who });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.plan, kind);
  assert.equal(me.json.paid, false);
  assert.equal(me.json.rehab_names, false);
  assert.equal(me.json.export, false);
  assert.equal(me.json.search.limit, 3);
  assert.equal(me.json.alerts.allowed, true);
  assert.equal(me.json.alerts.limit, 1);
  assert.equal(me.json.search.allowed, searches < 3);

  const near = await api("/api/near?q=Pilsen", { who });
  if (searches < 3) {
    assert.equal(near.status, 200, near.text);
    assert.equal(near.json.usage.used, searches + 1);
    assert.equal(near.json.usage.limit, 3);
    assert.equal(typeof near.json.usage.resets_at, "string");
  } else {
    assert.equal(near.status, 429, near.text);
    assert.equal(near.json.code, "limit_reached");
    assert.equal(typeof near.json.resets_at, "string");
    assert.equal(near.json.permits, undefined);
  }

  const tract = await api(`/api/tract/${busy}`, { who });
  assert.equal(tract.status, 200, tract.text);
  assert.ok(tract.json.top_permits.length > 1);
  assert.equal(tract.json.wayback.available, true);
  assert.ok(Array.isArray(tract.json.nearby_projects));
  assertPreviewList(tract.json.rehab);
  assert.ok(tract.json.locked.includes("rehab"));

  const rehab = await api(`/api/rehab?geoid=${busy}`, { who });
  assert.equal(rehab.status, 200, rehab.text);
  assertPreviewList(rehab.json);
  for (const id of hiddenIds()) assert.equal(rehab.text.includes(`"${id}"`), false);

  const memo = await api("/api/memo", { method: "POST", who, body: { geoid: busy } });
  assert.equal(memo.status, 200, memo.text);
  assert.equal(memo.json.access, "preview");
  assert.equal(sections(memo.json.memo_markdown), 1);
  assert.equal(memo.json.memo_markdown.includes(fullRows[1].address), false);

  const report = await api("/api/report", {
    method: "POST",
    who,
    body: { report_type: "area", target_id: busy },
  });
  assert.equal(report.status, 402, report.text);
  assert.equal(report.json.code, "payment_required");
  assert.equal(sections(report.json.preview.first_section_markdown), 1);

  const exported = await api(`/api/export?report_type=area&target_id=${busy}`, { who });
  assert.equal(exported.status, 402, exported.text);

  const alerts = await api("/api/alerts", {
    method: "POST",
    who: { ...who, alerts_used: 1 },
    body: { area_id: "tract-2" },
  });
  assert.equal(alerts.status, 429, alerts.text);
  const firstAlert = await api("/api/alerts", {
    method: "POST",
    who: { ...who, alerts_used: 0 },
    body: { area_id: "tract-1" },
  });
  assert.equal(firstAlert.status, 200, firstAlert.text);
}

before(async () => {
  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        EMRIS_TEST_ACCESS: "1",
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const keep = (chunk) => {
    log = (log + chunk.toString()).slice(-12000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(log);
    try {
      const res = await fetch(`${base}/api/tracts`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!ready) throw new Error(`server did not start\n${log}`);

  const tracts = await api("/api/tracts");
  assert.equal(tracts.status, 200, tracts.text);
  const ranked = tracts.json.features
    .map((feature) => ({
      id: feature.properties.geoid,
      n: feature.properties.permit_count_24mo,
    }))
    .sort((a, b) => b.n - a.n);
  assert.ok(ranked[0].n > 1);
  assert.ok(ranked[1].n > 1);
  busy = ranked[0].id;
  other = ranked[1].id;

  const rehab = await api(`/api/rehab?geoid=${busy}`, { who: paid("pro") });
  assert.equal(rehab.status, 200, rehab.text);
  fullRows = rehab.json.rows;
  assert.ok(fullRows.length > 1);
});

after(() => {
  child?.kill("SIGTERM");
});

test("limits match the plan", async () => {
  const me = await api("/api/me");
  assert.equal(me.json.limits.free_searches, 3);
  assert.equal(me.json.limits.search_window_days, 7);
  assert.equal(me.json.limits.free_alerts, 1);
  assert.equal(me.json.limits.grace_days, 7);
  assert.equal(me.json.limits.founding_cap, 25);
  assert.equal(me.json.limits.team_seats, 5);
  assert.equal(me.json.limits.pro_trial_days, 14);
});

test("signed out sees the map and nothing else", async () => {
  const me = await api("/api/me");
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.plan, "anonymous");
  assert.equal(me.json.paid, false);
  assert.equal(me.json.search.allowed, false);
  assert.equal(me.json.rehab_names, false);
  assert.equal(me.json.export, false);
  assert.equal(me.json.alerts.allowed, false);

  const tracts = await api("/api/tracts");
  assert.equal(tracts.status, 200);
  assert.equal(typeof tracts.json.features[0].properties.score, "number");

  const tract = await api(`/api/tract/${busy}`);
  assert.equal(tract.status, 200, tract.text);
  assert.equal(typeof tract.json.tract.score, "number");
  assert.equal(tract.json.top_permits, undefined);
  assert.equal(tract.json.wayback, undefined);
  assert.equal(tract.json.rehab, undefined);
  assert.ok(Array.isArray(tract.json.nearby_projects));
  for (const field of ["top_permits", "wayback", "rehab"]) {
    assert.ok(tract.json.locked.includes(field));
  }
  for (const id of fullRows.map((row) => row.permit_id)) {
    assert.equal(tract.text.includes(`"${id}"`), false);
  }

  const rehab = await api(`/api/rehab?geoid=${busy}`);
  assert.equal(rehab.status, 200, rehab.text);
  assert.equal(rehab.json.count, undefined);
  assert.deepEqual(rehab.json.rows, []);
  for (const id of hiddenIds()) assert.equal(rehab.text.includes(`"${id}"`), false);

  for (const [pathname, init] of [
    ["/api/near?q=Pilsen", {}],
    ["/api/memo", { method: "POST", body: { geoid: busy } }],
    ["/api/report", { method: "POST", body: { report_type: "area", target_id: busy } }],
    [`/api/export?report_type=area&target_id=${busy}`, {}],
    ["/api/alerts", { method: "POST", body: { area_id: "tract-1" } }],
    ["/api/checkout", { method: "POST", body: { plan: "pro" } }],
  ]) {
    const res = await api(pathname, init);
    assert.equal(res.status, 401, `${pathname} ${res.text}`);
    assert.equal(res.json.code, "auth_required");
  }
});

test("free account at 0 searches", async () => {
  await expectFree(user("user-free-0"), { kind: "free", searches: 0 });
});

test("free account at 3 searches", async () => {
  await expectFree(user("user-free-3", { searches_used: 3 }), { kind: "free", searches: 3 });
});

test("report buyer gets only the purchased report", async () => {
  const who = user("user-report", {
    searches_used: 3,
    entitlements: [{ report_type: "area", target_id: busy }],
  });
  const me = await api("/api/me", { who });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.plan, "report");
  assert.equal(me.json.paid, false);
  assert.equal(me.json.rehab_names, false);
  assert.equal(me.json.export, false);
  assert.equal(me.json.search.allowed, true);
  assert.equal(me.json.search.limit, null);
  assert.equal(me.json.alerts.allowed, false);

  const near = await api("/api/near?q=Pilsen", { who });
  assert.equal(near.status, 200, near.text);
  assert.equal(near.json.usage.limit, null);

  const owned = await api(`/api/tract/${busy}`, { who });
  assert.equal(owned.status, 200, owned.text);
  assert.ok(owned.json.top_permits.length > 1);
  assert.equal(owned.json.wayback.available, true);
  assertFullList(owned.json.rehab);

  const elsewhere = await api(`/api/tract/${other}`, { who });
  assert.equal(elsewhere.status, 200, elsewhere.text);
  assert.equal(elsewhere.json.rehab.rows.length, 1);
  assert.ok(elsewhere.json.rehab.count > 1);
  assert.equal(elsewhere.json.rehab.locked, true);

  const memo = await api("/api/memo", { method: "POST", who, body: { geoid: busy } });
  assert.equal(memo.status, 200, memo.text);
  assert.equal(memo.json.access, "full");
  assert.equal(sections(memo.json.memo_markdown), 5);
  const otherMemo = await api("/api/memo", { method: "POST", who, body: { geoid: other } });
  assert.equal(otherMemo.json.access, "preview");
  assert.equal(sections(otherMemo.json.memo_markdown), 1);

  const report = await api("/api/report", {
    method: "POST",
    who,
    body: { report_type: "area", target_id: busy },
  });
  assert.equal(report.status, 200, report.text);
  assert.equal(report.json.report.rehab.rows.length, fullRows.length);
  const denied = await api("/api/report", {
    method: "POST",
    who,
    body: { report_type: "area", target_id: other },
  });
  assert.equal(denied.status, 402, denied.text);

  const exported = await api(`/api/export?report_type=area&target_id=${busy}`, { who });
  assert.equal(exported.status, 200, exported.text);
  assert.equal(exported.json.rows.length, fullRows.length);
  const otherExport = await api(`/api/export?report_type=area&target_id=${other}`, { who });
  assert.equal(otherExport.status, 402, otherExport.text);

  const alerts = await api("/api/alerts", { method: "POST", who, body: { area_id: "tract-1" } });
  assert.equal(alerts.status, 402, alerts.text);

  const again = await api("/api/checkout", {
    method: "POST",
    who,
    body: { report_type: "area", target_id: busy },
  });
  assert.equal(again.status, 409, again.text);
  const another = await api("/api/checkout", {
    method: "POST",
    who,
    body: { report_type: "area", target_id: other },
  });
  assert.equal(another.status, 200, another.text);
  assert.ok(another.json.url.startsWith("https://checkout.stripe.com/"));
});

test("pro has the paid column", async () => {
  await expectSubscription(paid("pro"), "pro");
  const checkout = await api("/api/checkout", {
    method: "POST",
    who: paid("pro"),
    body: { report_type: "area", target_id: busy },
  });
  assert.equal(checkout.status, 409, checkout.text);
});

test("founding member has the paid column and the cap holds", async () => {
  const who = paid("founding");
  await expectSubscription(who, "founding");
  const open = await api("/api/checkout", {
    method: "POST",
    who: user("user-new-founding"),
    body: { plan: "founding" },
    headers: { "x-emris-founding-count": "24" },
  });
  assert.equal(open.status, 200, open.text);
  const closed = await api("/api/checkout", {
    method: "POST",
    who: user("user-late-founding"),
    body: { plan: "founding" },
    headers: { "x-emris-founding-count": "25" },
  });
  assert.equal(closed.status, 409, closed.text);
  assert.equal(closed.json.code, "founding_cap");
});

test("team owner and team member have the paid column", async () => {
  const owner = paid("team", "owner");
  const member = paid("team", "member");
  await expectSubscription(owner, "team");
  await expectSubscription(member, "team");

  const invite = await api("/api/team/invite", {
    method: "POST",
    who: owner,
    body: { email: "teammate@example.com" },
  });
  assert.equal(invite.status, 200, invite.text);
  assert.equal(invite.json.seat_limit, 5);

  const full = await api("/api/team/invite", {
    method: "POST",
    who: { ...owner, seats_used: 5 },
    body: { email: "another@example.com" },
  });
  assert.equal(full.status, 409, full.text);
  assert.equal(full.json.code, "seat_cap");

  const memberInvite = await api("/api/team/invite", {
    method: "POST",
    who: member,
    body: { email: "another@example.com" },
  });
  assert.equal(memberInvite.status, 402, memberInvite.text);
});

test("a trial and a failed payment inside grace stay paid", async () => {
  await expectSubscription(
    user("user-trial", {
      searches_used: 99,
      alerts_used: 99,
      subscription: { plan: "pro", status: "trialing" },
    }),
    "pro",
  );
  await expectSubscription(
    user("user-grace", {
      searches_used: 99,
      alerts_used: 99,
      subscription: {
        plan: "pro",
        status: "past_due",
        payment_failed_at: new Date(Date.now() - 6 * day).toISOString(),
      },
    }),
    "pro",
  );
  await expectSubscription(
    user("user-cancel-open", {
      searches_used: 99,
      alerts_used: 99,
      subscription: {
        plan: "pro",
        status: "canceled",
        current_period_end: new Date(Date.now() + day).toISOString(),
      },
    }),
    "pro",
  );
});

test("failed payment past grace is a free account", async () => {
  const who = user("user-past-grace", {
    subscription: {
      plan: "pro",
      status: "past_due",
      payment_failed_at: new Date(Date.now() - 8 * day).toISOString(),
    },
  });
  await expectFree(who, { kind: "past_due", searches: 0 });
  const blocked = user("user-past-grace-spent", {
    searches_used: 3,
    subscription: who.subscription,
  });
  const near = await api("/api/near?q=Pilsen", { who: blocked });
  assert.equal(near.status, 429, near.text);
  assert.equal(near.json.code, "limit_reached");
});

test("stripe webhook rejects a bad signature and accepts a good one", async () => {
  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        payment_status: "paid",
        client_reference_id: "user-report",
        metadata: { report_type: "area", target_id: busy },
      },
    },
  });
  const bad = await api("/api/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": "t=1,v1=deadbeef" },
  });
  assert.equal(bad.status, 400, bad.text);

  const stamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${stamp}.${payload}`).digest("hex");
  const good = await fetch(`${base}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${stamp},v1=${signature}`,
    },
    body: payload,
  });
  const text = await good.text();
  assert.equal(good.status, 200, text);
  assert.equal(JSON.parse(text).received, true);
});
