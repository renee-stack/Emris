// Plan rules, copy, and list trimming. No database, Stripe, or filesystem imports:
// client components import this file.

export const FREE_SEARCHES_PER_WEEK = 3;
export const TRIAL_DAYS = 7;
export const PRO_MONTHLY_USD = 249;
export const REPORT_USD = 79;
export const SEARCH_REPEAT_MS = 60_000;

export type Plan = "free" | "trial" | "pro";
export type AccessLevel = "full" | "preview";
export type CheckoutIntent = "pro" | "report";

export type EventName =
  | "signup"
  | "onboarding_complete"
  | "search_limit_hit"
  | "paywall_view"
  | "checkout_started"
  | "upgraded";

export const PAYWALL_SURFACES = [
  "search_limit",
  "tract_summary",
  "memo",
  "multifamily",
  "permit_history",
  "rehab_candidates",
  "owners",
] as const;

export type PaywallSurface = (typeof PAYWALL_SURFACES)[number];

export interface RecordPreview<T> {
  total: number;
  rows: T[];
}

export interface AccountSnapshot {
  plan: Plan;
  email: string | null;
  trial_ends_at: string | null;
  trial_ends_label: string | null;
  trial_available: boolean;
  has_billing: boolean;
  searches_limit: number | null;
  searches_remaining: number | null;
  searches_resets_at: string | null;
  searches_resets_label: string | null;
}

export interface SearchLimitPayload {
  code: "search_limit";
  error: string;
  query: string;
  limit: number;
  used: number;
  remaining: number;
  resets_at: string;
  resets_label: string;
  summary: string;
}

const CHICAGO = "America/Chicago";

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function zonedParts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  return bag;
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Midnight on a Chicago calendar date, as a UTC instant. Month is 0-based. */
export function chicagoMidnightUtc(year: number, monthIndex: number, day: number): Date {
  const utcMidnight = Date.UTC(year, monthIndex, day, 0, 0, 0);
  const corrected = utcMidnight - tzOffsetMs(new Date(utcMidnight), CHICAGO);
  return new Date(utcMidnight - tzOffsetMs(new Date(corrected), CHICAGO));
}

export interface ChicagoWeek {
  start: Date;
  reset: Date;
}

/**
 * Monday 00:00 through the next Monday 00:00, America/Chicago.
 * The end is the following Monday's midnight, not start + 168 hours, so a
 * daylight-saving change in the middle of the week does not move the reset.
 */
export function chicagoWeek(now: Date): ChicagoWeek {
  const parts = zonedParts(now, CHICAGO);
  const back = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  monday.setUTCDate(monday.getUTCDate() - back);
  const start = chicagoMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
  const next = new Date(monday.getTime());
  next.setUTCDate(next.getUTCDate() + 7);
  const reset = chicagoMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  return { start, reset };
}

export function formatChicagoDate(date: Date, withWeekday = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    weekday: withWeekday ? "long" : undefined,
    month: "long",
    day: "numeric",
    year: withWeekday ? undefined : "numeric",
  }).format(date);
}

export function searchMeterCopy(remaining: number, limit: number): string {
  return `${remaining} of ${limit} free searches left this week`;
}

export function cleanQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function normalizeQuery(query: string): string {
  return cleanQuery(query).toLowerCase();
}

export function searchLimitSummary(query: string): string {
  const q = cleanQuery(query);
  return `A search for "${q}" returns the tract score, permits within a quarter mile, and infrastructure nearby.`;
}

export function searchLimitPayload(query: string, used: number, reset: Date): SearchLimitPayload {
  const resetsLabel = formatChicagoDate(reset, true);
  return {
    code: "search_limit",
    error: "Free searches are used for this week.",
    query: cleanQuery(query),
    limit: FREE_SEARCHES_PER_WEEK,
    used,
    remaining: 0,
    resets_at: reset.toISOString(),
    resets_label: resetsLabel,
    summary: searchLimitSummary(query),
  };
}

function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function tractUpsell(counts: {
  multifamily: number;
  rehab: number;
  permits: number;
  owners: number;
}): string | null {
  const mfLocked = counts.multifamily > 1;
  const rehabLocked = counts.rehab > 1;
  if (mfLocked || rehabLocked) {
    const parts: string[] = [];
    if (counts.multifamily > 0) parts.push(countNoun(counts.multifamily, "multifamily permit", "multifamily permits"));
    if (counts.rehab > 0) parts.push(countNoun(counts.rehab, "rehab candidate", "rehab candidates"));
    if (parts.length === 0) return null;
    const joined = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
    return `This tract has ${joined}. See them all with Pro.`;
  }
  if (counts.permits > 1) {
    return `This tract has ${countNoun(counts.permits, "permit", "permits")} on file. See the full history with Pro.`;
  }
  if (counts.owners > 1) {
    return `This tract has ${countNoun(counts.owners, "owner name", "owner names")} on file. See them all with Pro.`;
  }
  return null;
}

export function upgradeHref(opts: { intent: CheckoutIntent; surface: string; geoid?: string }): string {
  const params = new URLSearchParams({ intent: opts.intent, surface: opts.surface });
  if (opts.geoid) params.set("geoid", opts.geoid);
  return `/upgrade?${params.toString()}`;
}

export function previewRecords<T>(items: T[], access: AccessLevel): RecordPreview<T> {
  return {
    total: items.length,
    rows: access === "full" ? items.slice() : items.slice(0, 1),
  };
}

const REHAB = /\b(REHABILITATION|RENOVATION|RENOVATIONS|ALTERATION|ALTERATIONS|REMODEL|REMODELED)\b/i;
const RESIDENTIAL = /\b(R-2|R-5|DWELLING|MULTI-FAMILY|MULTIFAMILY|RESIDENCE|RESIDENTIAL|APARTMENT)\b/i;
const GROUND_UP = /\b(NEW CONSTRUCTION|ERECT NEW|ERECT A|FOUNDATION ONLY|FOUNDATION PERMIT|CAISSON ONLY|PILES ONLY)\b/i;

/** Work on an existing residential building, not a ground-up filing. */
export function isRehabCandidate(permit: { description: string }): boolean {
  const description = permit.description;
  if (!REHAB.test(description) || !RESIDENTIAL.test(description)) return false;
  if (GROUND_UP.test(description) && !/\bEXISTING\b/i.test(description)) return false;
  return true;
}

const UNIT_PATTERNS = [
  /(\d+)\s*-?\s*D\.?U\.?\b/i,
  /(\d+)\s+DWELLING UNITS?\b/i,
  /(\d+)\s*-?\s*UNITS?\b/i,
  /(\d+)\s+APARTMENT UNITS?\b/i,
];

/** Five or more units, or an explicit multifamily occupancy when the unit count was not reported. */
export function isMultifamilyPermit(permit: { units: number | null; description: string }): boolean {
  if (permit.units != null) return permit.units >= 5;
  for (const pattern of UNIT_PATTERNS) {
    const match = permit.description.match(pattern);
    if (match && Number(match[1]) >= 5) return true;
  }
  return /\b(R-2|MULTI-FAMILY|MULTIFAMILY)\b/i.test(permit.description);
}

export function firstMemoSection(markdown: string): { markdown: string; locked: string[] } {
  const text = markdown.replace(/^\uFEFF/, "").trim();
  const parts = text.split(/\n(?=## )/);
  if (parts.length <= 1) {
    const blocks = text.split(/\n\n+/);
    if (blocks.length <= 1) return { markdown: text, locked: [] };
    return { markdown: blocks[0]?.trim() ?? text, locked: ["Remaining sections"] };
  }
  const locked = parts
    .slice(1)
    .map((part) => part.split("\n")[0]?.replace(/^##\s+/, "").trim() ?? "")
    .filter(Boolean);
  return { markdown: parts[0]?.trim() ?? text, locked };
}

export function gateMemo<T extends { geoid: string; title: string; memo_markdown: string }>(
  memo: T,
  access: AccessLevel,
): T & { access: AccessLevel; locked_sections: string[] } {
  if (access === "full") {
    return { ...memo, access: "full", locked_sections: [] };
  }
  const split = firstMemoSection(memo.memo_markdown);
  return {
    ...memo,
    memo_markdown: split.markdown,
    access: "preview",
    locked_sections: split.locked,
  };
}

export function trialAvailable(user: { plan: Plan; trialEndsAt: string | null } | null): boolean {
  if (!user) return true;
  if (user.plan !== "free") return false;
  return user.trialEndsAt == null;
}

export function hasProAccess(
  user: { plan: Plan; trialEndsAt: string | null; subscriptionStatus: string | null } | null,
  now = new Date(),
): boolean {
  if (!user) return false;
  if (user.plan === "pro") return true;
  if (user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due") return true;
  if (user.plan === "trial" && user.trialEndsAt && Date.parse(user.trialEndsAt) > now.getTime()) return true;
  return false;
}

export function effectivePlan(
  user: { plan: Plan; trialEndsAt: string | null; subscriptionStatus: string | null } | null,
  now = new Date(),
): Plan {
  if (!user) return "free";
  if (user.plan === "pro" || user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due") {
    return "pro";
  }
  if (user.plan === "trial" && user.trialEndsAt && Date.parse(user.trialEndsAt) > now.getTime()) return "trial";
  return "free";
}

export function sectionList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function trialEndingEmail(input: { trialEndsAt: string; accountUrl: string }): { subject: string; text: string } {
  const when = formatChicagoDate(new Date(input.trialEndsAt));
  return {
    subject: `Your Emris Pro trial ends ${when}`,
    text: [
      `Your Emris Pro trial ends ${when}.`,
      "",
      `The card you entered at checkout will be charged $${PRO_MONTHLY_USD} for the next month unless you cancel before then.`,
      "",
      `After the trial, the map returns to the free plan: ${FREE_SEARCHES_PER_WEEK} searches a week, the first row of each record list, and the opening section of an IC memo.`,
      "",
      "To keep Pro, no action is needed.",
      `To cancel before the charge, open billing: ${input.accountUrl}`,
      "",
      "Emris",
    ].join("\n"),
  };
}

export function proOfferCopy(trial: boolean): string {
  if (trial) {
    return `${TRIAL_DAYS}-day trial. A card is required. $${PRO_MONTHLY_USD} a month after the trial unless you cancel.`;
  }
  return `$${PRO_MONTHLY_USD} a month. This account has already used the trial. A card is required.`;
}

export function reportOfferCopy(): string {
  return `$${REPORT_USD}. The IC memo and the full record lists for this tract. It does not include unlimited search.`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export const GEOID_RE = /^\d{11}$/;
