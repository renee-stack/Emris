/**
 * Emris plan catalog. Amounts are USD cents.
 * Annual prices are ten months: two months free.
 * Purchase rules live in lib/billing and run only on the server.
 */

export const FOUNDING_SPOTS = 50;
export const FOUNDING_MONTHLY_CENTS = 9900;
export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 3;
export const TEAM_MIN_SEATS = 3;
export const TEAM_MAX_SEATS = 100;
export const INVITE_TTL_DAYS = 7;
export const FOUNDING_GONE = "Founding spots are gone";

export const CONTACT_EMAIL = "renee@lumina.house";

export type Interval = "month" | "year";
export type AccountPlan = "free" | "pro" | "team" | "founding";
export type ReportPlan = "area_report" | "property_report";
export type PurchasablePlan = "pro" | "team" | "founding" | ReportPlan;
export type SubscriptionPlan = "pro" | "team" | "founding";

export function annualCents(monthlyCents: number): number {
  return monthlyCents * 10;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

type SubscriptionOffer = {
  kind: "subscription";
  id: SubscriptionPlan;
  name: string;
  monthlyCents: number;
  perSeat: boolean;
  summary: string;
  features: string[];
};

type ReportOffer = {
  kind: "payment";
  id: ReportPlan;
  name: string;
  cents: number;
  reportType: "area" | "property";
  summary: string;
  includes: string[];
};

export const freePlan = {
  id: "free" as const,
  name: "Free",
  summary: "A free account for the map, limited search, and a first look at the memo.",
  features: [
    "Tract scores, map, and catalyst pins",
    "Wayback slider and tract age shading",
    "3 searches a week",
    "Permit addresses and descriptions",
    "Rehab candidates shown as a blurred list",
    "Preview of the first memo section",
    "1 watchlist area",
  ],
};

export const proPlan: SubscriptionOffer = {
  kind: "subscription",
  id: "pro",
  name: "Pro",
  monthlyCents: 14900,
  perSeat: false,
  summary: "Unlimited search, every rehab candidate, and memos for one person.",
  features: [
    "Everything in Free",
    "Unlimited search and nearby permits",
    "Named rehab candidates in every place",
    "Unlimited IC memo PDFs",
    "Watchlists and email alerts",
    "7-day trial the first time you subscribe",
  ],
};

export const teamPlan: SubscriptionOffer = {
  kind: "subscription",
  id: "team",
  name: "Team",
  monthlyCents: 9900,
  perSeat: true,
  summary: "Pro for a shared seat pool. Checkout starts at 3 seats.",
  features: [
    "Everything in Pro",
    "Seats for the people you invite",
    "Invite by email, remove members any time",
    "Add seats from the billing portal",
    "7-day trial the first time you subscribe",
  ],
};

export const foundingPlan: SubscriptionOffer = {
  kind: "subscription",
  id: "founding",
  name: "Founding",
  monthlyCents: FOUNDING_MONTHLY_CENTS,
  perSeat: false,
  summary: "Pro features at a locked monthly price for the first 50 active members.",
  features: [
    "Everything in Pro",
    `${formatUsd(FOUNDING_MONTHLY_CENTS)} a month, kept for life`,
    `${FOUNDING_SPOTS} active memberships`,
  ],
};

export const areaReport: ReportOffer = {
  kind: "payment",
  id: "area_report",
  name: "Area report",
  cents: 7900,
  reportType: "area",
  summary: "One tract or a drawn radius. Pay once. The entitlement stays on your account.",
  includes: [
    "Score history and momentum",
    "Multifamily permits from the last 24 months",
    "Catalysts with their sources",
    "Building age profile",
    "Top rehab candidates",
    "Comparable tracts and the IC memo",
  ],
};

export const propertyReport: ReportOffer = {
  kind: "payment",
  id: "property_report",
  name: "Property report",
  cents: 4900,
  reportType: "property",
  summary: "One address. Pay once. The entitlement stays on your account.",
  includes: [
    "Year built, units, and alteration history",
    "Permits on the parcel",
    "Rehab score, factor by factor",
    "Owner of record where the public record has it",
    "The surrounding tract's path of progress",
    "IC memo framed on that property",
  ],
};

export const reports: ReportOffer[] = [areaReport, propertyReport];

export const comparison: { feature: string; cells: [string, string, string] }[] = [
  { feature: "Tract scores, map, catalyst pins", cells: ["Yes", "Yes", "Yes"] },
  { feature: "Wayback slider, tract age shading", cells: ["Yes", "Yes", "Yes"] },
  { feature: "Search + nearby permits", cells: ["3 a week", "Unlimited", "Unlimited"] },
  { feature: "Permit addresses and descriptions", cells: ["Yes", "Yes", "Yes"] },
  {
    feature: "Named rehab candidates with owner + permit history",
    cells: ["Blurred list", "All places", "All places"],
  },
  {
    feature: "IC memo (PDF)",
    cells: ["Preview of the first section", "Unlimited", "Unlimited"],
  },
  { feature: "Watchlists + email alerts", cells: ["1 area", "Yes", "Yes"] },
  { feature: "Seats", cells: ["1", "1", "3 or more"] },
];

export const pricingFaq: { q: string; a: string }[] = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Open the billing portal and cancel. The subscription stops renewing at the end of the period you've already paid, and the account returns to Free. There's no cancellation fee. A founding member keeps the $99 price if they subscribe again.",
  },
  {
    q: "What counts as a search?",
    a: "Each successful nearby search counts as one. A free account gets 3 in a rolling 7 days. Opening the map, a tract, or a report you already own does not count. Pro and Team search without that cap.",
  },
  {
    q: "How do reports work?",
    a: "Area and property reports are one-time payments. You buy one from a tract, a drawn radius, or a property. When Stripe confirms payment, Emris stores an entitlement for that target. The report is checked on the server. A repeat webhook does not create a second entitlement.",
  },
  {
    q: "What does data coverage mean?",
    a: "Every tract says how many of its three signals were present. A missing signal is left out and its weight is spread across the ones that are there, so the score isn't padded with a guess. Baseline coverage is labeled as baseline data only.",
  },
];

export function planLabel(plan: string): string {
  switch (plan) {
    case "pro":
      return "Pro";
    case "team":
      return "Team";
    case "founding":
      return "Founding";
    case "area_report":
      return areaReport.name;
    case "property_report":
      return propertyReport.name;
    default:
      return "Free";
  }
}

export function isSubscriptionPlan(plan: string): plan is SubscriptionPlan {
  return plan === "pro" || plan === "team" || plan === "founding";
}

export function isReportPlan(plan: string): plan is ReportPlan {
  return plan === "area_report" || plan === "property_report";
}

export function isPurchasablePlan(plan: string): plan is PurchasablePlan {
  return isSubscriptionPlan(plan) || isReportPlan(plan);
}

export function chargeCents(plan: PurchasablePlan, interval: Interval | null): number {
  if (plan === "area_report") return areaReport.cents;
  if (plan === "property_report") return propertyReport.cents;
  const monthly =
    plan === "pro" ? proPlan.monthlyCents : plan === "team" ? teamPlan.monthlyCents : foundingPlan.monthlyCents;
  if (plan === "founding" || interval !== "year") return monthly;
  return annualCents(monthly);
}

export function lookupKey(plan: PurchasablePlan, interval: Interval | null): string {
  if (plan === "area_report" || plan === "property_report") return plan;
  if (plan === "founding") return "founding_month";
  return `${plan}_${interval === "year" ? "year" : "month"}`;
}

export function planFromLookup(key: string | null | undefined): {
  plan: PurchasablePlan;
  interval: Interval | null;
} | null {
  switch (key) {
    case "pro_month":
      return { plan: "pro", interval: "month" };
    case "pro_year":
      return { plan: "pro", interval: "year" };
    case "team_month":
      return { plan: "team", interval: "month" };
    case "team_year":
      return { plan: "team", interval: "year" };
    case "founding_month":
      return { plan: "founding", interval: "month" };
    case "area_report":
      return { plan: "area_report", interval: null };
    case "property_report":
      return { plan: "property_report", interval: null };
    default:
      return null;
  }
}

export function productName(plan: PurchasablePlan): string {
  switch (plan) {
    case "pro":
      return "Emris Pro";
    case "team":
      return "Emris Team";
    case "founding":
      return "Emris Founding";
    case "area_report":
      return "Emris area report";
    case "property_report":
      return "Emris property report";
  }
}

export function reportTypeFor(plan: ReportPlan): "area" | "property" {
  return plan === "area_report" ? "area" : "property";
}

const PRICE_ENV: Record<string, string> = {
  pro_month: "STRIPE_PRICE_PRO_MONTH",
  pro_year: "STRIPE_PRICE_PRO_YEAR",
  team_month: "STRIPE_PRICE_TEAM_MONTH",
  team_year: "STRIPE_PRICE_TEAM_YEAR",
  founding_month: "STRIPE_PRICE_FOUNDING_MONTH",
  area_report: "STRIPE_PRICE_AREA_REPORT",
  property_report: "STRIPE_PRICE_PROPERTY_REPORT",
};

export function priceEnvName(key: string): string | null {
  return PRICE_ENV[key] ?? null;
}
