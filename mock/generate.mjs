// Generates fake data in the exact shapes from contract.md, scored with contract §3.
// Deterministic. Run: node mock/generate.mjs  (writes mock/, data/, public/)
import fs from "node:fs";
import path from "node:path";

const AS_OF = "2026-10-30";
const asOf = new Date(AS_OF + "T00:00:00Z");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

let seed = 20261030;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// Five neighborhoods, five rectangular tracts each (3 + 2 grid).
// rising = permits skew recent (positive momentum).
const HOODS = [
  { name: "Logan Square", lat: 41.9235, lng: -87.7085, tracts: ["2215", "2216", "2217", "2220", "2222"], permits: 9, rising: false,
    streets: ["N Kedzie Ave", "N Sacramento Ave", "N California Ave", "N Spaulding Ave", "N Kimball Ave", "N Whipple St"] },
  { name: "Humboldt Park", lat: 41.9025, lng: -87.721, tracts: ["2301", "2303", "2304", "2305", "2309"], permits: 5, rising: false,
    streets: ["N Kedzie Ave", "N Spaulding Ave", "N Christiana Ave", "N Homan Ave", "N Sawyer Ave", "N California Ave"] },
  { name: "West Loop", lat: 41.883, lng: -87.648, tracts: ["2831", "2832", "2833", "8330", "8331"], permits: 10, rising: false,
    streets: ["N Halsted St", "N Green St", "N Peoria St", "N Sangamon St", "N Morgan St", "N Aberdeen St", "N Racine Ave"] },
  { name: "Pilsen", lat: 41.8565, lng: -87.662, tracts: ["3101.01", "3101.02", "3102", "3103", "8431"], permits: 8, rising: true,
    streets: ["S Halsted St", "S Morgan St", "S Racine Ave", "S Loomis St", "S Ashland Ave", "S Throop St"] },
  { name: "Bronzeville", lat: 41.824, lng: -87.617, tracts: ["3511", "3512", "3514", "3515", "8357"], permits: 8, rising: true,
    streets: ["S Dr Martin Luther King Jr Dr", "S Prairie Ave", "S Indiana Ave", "S Calumet Ave", "S Michigan Ave", "S State St"] },
];
const DLAT = 0.009, DLNG = 0.012;
const GRID = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]];

// ---- tracts ----
const tracts = [];
for (const h of HOODS) {
  const lat0 = h.lat - DLAT, lng0 = h.lng - 1.5 * DLNG;
  h.tracts.forEach((num, i) => {
    const [c, r] = GRID[i];
    const w = r6(lng0 + c * DLNG), e = r6(lng0 + (c + 1) * DLNG);
    const s = r6(lat0 + r * DLAT), n = r6(lat0 + (r + 1) * DLAT);
    const [whole, frac = "00"] = num.split(".");
    const geoid = "17031" + whole.padStart(4, "0") + frac.padEnd(2, "0");
    tracts.push({
      hood: h, geoid, name: `${h.name} · Tract ${num}`,
      bbox: { w, e, s, n }, centroid: { lat: (s + n) / 2, lng: (w + e) / 2 },
      ring: [[w, s], [e, s], [e, n], [w, n], [w, s]],
    });
  });
}

// ---- permits ----
const isoDaysAgo = (d) => new Date(asOf.getTime() - d * 86400e3).toISOString().slice(0, 10);
const permits = [];
let pid = 100950000;
for (const h of HOODS) {
  const ts = tracts.filter((t) => t.hood === h);
  for (let k = 0; k < h.permits; k++) {
    // first tracts in each hood are hotter
    const t = ts[Math.min(ts.length - 1, Math.floor(rnd() ** 1.6 * ts.length))];
    const lat = r6(t.bbox.s + rnd() * (t.bbox.n - t.bbox.s));
    const lng = r6(t.bbox.w + rnd() * (t.bbox.e - t.bbox.w));
    const months = h.rising ? rnd() ** 2.2 * 30 : rnd() * 30;
    const u = rnd();
    let units, description;
    if (u < 0.15) {
      units = null;
      description = "Erect new mixed-use building per plans; unit count not reported";
    } else if (u < 0.4) {
      units = 2 + Math.floor(rnd() * 3);
      description = `Erect a 3-story, ${units}-unit masonry residential building with rear garage`;
    } else {
      units = 5 + Math.floor(rnd() ** 2 * 140);
      const stories = Math.max(3, Math.min(14, Math.round(units / 9) + 2));
      description = `Erect a ${stories}-story, ${units}-unit residential building` +
        (rnd() < 0.5 ? " with ground-floor retail" : " with enclosed parking");
    }
    // Chicago grid: 800 address numbers per mile, origin State & Madison
    let num = Math.round((Math.abs(lat - 41.8819) / 0.01447) * 800);
    num = num - (num % 2) + (rnd() < 0.5 ? 1 : 0);
    permits.push({
      id: String(pid += 1 + Math.floor(rnd() * 900)),
      address: `${num} ${lat >= 41.8819 ? "N" : "S"} ${pick(h.streets).slice(2)}`,
      lat, lng,
      issue_date: isoDaysAgo(Math.floor(months * 30.44)),
      units, description, geoid: t.geoid,
    });
  }
}
permits.sort((a, b) => b.issue_date.localeCompare(a.issue_date));

// ---- infrastructure ----
const P = (id, name, type, status, lat, lng, budget_usd, expected_completion, description) =>
  ({ id, name, type, status, lat, lng, budget_usd, expected_completion, description, source_url: null });
const projects = [
  P("infra-001", "Milwaukee Ave Streetscape (Logan Sq)", "streetscape", "under_construction", 41.9262, -87.7032, 18500000, "2027",
    "Wider sidewalks, protected bike lanes and bus bulbs along Milwaukee Ave near the Logan Square circle."),
  P("infra-002", "Bloomingdale Trail West Extension", "park", "planned", 41.9176, -87.7228, null, null,
    "Proposed westward extension of the elevated trail with new access ramps."),
  P("infra-003", "Chicago Ave Bus Priority Corridor", "transit", "funded", 41.8961, -87.7195, 32000000, "2028-Q2",
    "Dedicated bus lanes, signal priority and upgraded stops on Chicago Ave."),
  P("infra-004", "Humboldt Park Boathouse Restoration", "park", "complete", 41.9041, -87.7066, 9800000, "2025",
    "Restoration of the historic boathouse and lagoon edge."),
  P("infra-005", "Fulton Market Streetscape Phase 2", "streetscape", "under_construction", 41.8868, -87.6512, 24000000, "2027-Q1",
    "Curbless shared street, lighting and plantings on Fulton Market."),
  P("infra-006", "West Loop Public Library Expansion", "civic", "funded", 41.8812, -87.6448, 14500000, "2028",
    "Second-phase expansion with community rooms and teen space."),
  P("infra-007", "El Paseo Trail", "park", "funded", 41.8524, -87.6703, 21000000, "2028",
    "Rail-to-trail conversion along a former freight corridor."),
  P("infra-008", "18th St Pink Line Station Rehab", "transit", "planned", 41.8578, -87.6694, 40000000, "2029",
    "Accessibility upgrades, new platform canopy and elevators."),
  P("infra-009", "43rd St Green Line Accessibility", "transit", "under_construction", 41.8167, -87.6191, 38000000, "2027-Q3",
    "Elevator installation and station rebuild."),
  P("infra-010", "Bronzeville Lakefront Mixed-Use Site", "other", "planned", 41.8296, -87.6105, null, null,
    "Former hospital campus master plan with housing, retail and research space."),
];

// ---- scoring (contract §3) ----
const ageYears = (iso) => (asOf - new Date(iso + "T00:00:00Z")) / 86400e3 / 365.25;
const hav = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const pctRank = (vals) => vals.map((x) => {
  const below = vals.filter((v) => v < x).length, equal = vals.filter((v) => v === x).length;
  return Math.round((100 * (below + (equal - 1) / 2)) / (vals.length - 1));
});
const WEIGHT = { under_construction: 1, funded: 0.8, planned: 0.5, complete: 0 };
const decay = (d) => (d <= 0.25 ? 1 : d >= 1 ? 0 : (1 - d) / 0.75);

const raw = tracts.map((t) => {
  const ps = permits.filter((p) => p.geoid === t.geoid);
  const mf = ps.filter((p) => p.units !== null && p.units >= 5).reduce((s, p) => s + 0.5 ** ageYears(p.issue_date), 0);
  const L = ps.filter((p) => ageYears(p.issue_date) < 1).length;
  const Pr = ps.filter((p) => { const a = ageYears(p.issue_date); return a >= 1 && a < 2; }).length;
  const mom = (L - Pr) / Math.max(Pr, 1);
  const infra = projects.reduce((s, p) => s + WEIGHT[p.status] * decay(hav(t.centroid, p)), 0);
  const recent = ps.filter((p) => ageYears(p.issue_date) < 2);
  return { mf, mom, infra, count24: recent.length, units24: recent.reduce((s, p) => s + (p.units ?? 0), 0) };
});
const sMf = pctRank(raw.map((r) => r.mf));
const sMom = pctRank(raw.map((r) => r.mom));
const sInfra = pctRank(raw.map((r) => r.infra));
const composite = tracts.map((_, i) => 0.45 * sMf[i] + 0.3 * sMom[i] + 0.25 * sInfra[i]);
const score = pctRank(composite);

const features = tracts.map((t, i) => {
  const momentum_pct = Math.round(raw[i].mom * 1000) / 10;
  return {
    type: "Feature",
    properties: {
      geoid: t.geoid,
      name: t.name,
      score: score[i],
      percentile: Math.round((100 * composite.filter((c) => c < composite[i]).length) / tracts.length),
      momentum: momentum_pct >= 10 ? "up" : momentum_pct <= -10 ? "down" : "flat",
      momentum_pct,
      signals: { mf_permits: sMf[i], permit_momentum: sMom[i], infra_proximity: sInfra[i] },
      permit_count_24mo: raw[i].count24,
      units_24mo: raw[i].units24,
    },
    geometry: { type: "Polygon", coordinates: [t.ring] },
  };
});
const geojson = { type: "FeatureCollection", as_of: AS_OF, features };

// ---- write ----
const out = {
  "tracts.geojson": JSON.stringify(geojson, null, 2),
  "permits.json": JSON.stringify(permits, null, 2),
  "infrastructure.json": JSON.stringify(projects, null, 2),
};
for (const dir of ["mock", "data", "public"]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(root, dir, f), s + "\n");
}
console.log(`wrote ${features.length} tracts, ${permits.length} permits, ${projects.length} projects to mock/, data/, public/`);
