/**
 * Only source of truth for Emris prices, plan names, feature lists, and limits.
 * Amounts are US cents. Annual prices are monthly × ANNUAL_MULTIPLIER.
 * Stripe price ids are written by scripts/stripe_setup.ts under each lookup key.
 * Do not paste a price id by hand, and do not copy these amounts anywhere else.
 */

export const ANNUAL_MULTIPLIER = 10;

const proMonthlyCents = 14_900;
const foundingMonthlyCents = 9_900;
const teamMonthlyCents = 39_900;
const extraSeatMonthlyCents = 9_900;
const areaReportCents = 9_900;
const propertyReportCents = 4_900;

const freeSearches = 3;
const searchWindowDays = 7;
const foundingSubscriberCap = 50;
const teamIncludedSeats = 3;

export const pricing = {
  currency: "usd" as const,
  annualMultiplier: ANNUAL_MULTIPLIER,
  limits: {
    freeSearches,
    searchWindowDays,
    searchWindow: "rolling" as const,
    foundingSubscriberCap,
    teamIncludedSeats,
  },
  plans: {
    free: {
      name: "Free",
      summary: "Scores on the map, with a short search allowance.",
      monthlyCents: 0,
      annualCents: null,
      oneTimeCents: null,
      features: [
        "Path-of-progress scores on the map",
        `${freeSearches} searches in any rolling ${searchWindowDays} days`,
        "Permit list without the full filing detail",
      ],
    },
    pro: {
      name: "Pro",
      summary: "Unlimited search and the full filing record for one seat.",
      monthlyCents: proMonthlyCents,
      annualCents: proMonthlyCents * ANNUAL_MULTIPLIER,
      oneTimeCents: null,
      features: [
        "Unlimited search",
        "Full permit details",
        "Named rehab candidates with owner and permit history",
        "Unlimited investment committee memos",
        "Unlimited area and property reports",
        "Watchlists with email alerts",
        "CSV export",
      ],
    },
    founding: {
      name: "Founding Member Pro",
      summary: "Pro, at a monthly price that stays put for that subscription.",
      monthlyCents: foundingMonthlyCents,
      annualCents: null,
      oneTimeCents: null,
      lockedForSubscriptionLife: true,
      subscriberCap: foundingSubscriberCap,
      features: [
        "Everything in Pro",
        "Monthly price locked for the life of the subscription",
        `First ${foundingSubscriberCap} subscribers`,
      ],
    },
    team: {
      name: "Team",
      summary: "Pro for a small team, with room to add seats.",
      monthlyCents: teamMonthlyCents,
      annualCents: teamMonthlyCents * ANNUAL_MULTIPLIER,
      oneTimeCents: null,
      includedSeats: teamIncludedSeats,
      extraSeatMonthlyCents,
      extraSeatAnnualCents: extraSeatMonthlyCents * ANNUAL_MULTIPLIER,
      features: [
        "Everything in Pro",
        `${teamIncludedSeats} seats included`,
        "Extra seats billed on top of the base price",
        `Annual billing is ${ANNUAL_MULTIPLIER} times the monthly price`,
      ],
    },
    enterprise: {
      name: "Enterprise",
      summary: "A larger fund or a custom set of markets.",
      monthlyCents: null,
      annualCents: null,
      oneTimeCents: null,
      features: ["Coverage and seats arranged with you", "No public price", "Contact us"],
    },
    areaReport: {
      name: "Area Report",
      summary: "A one-time written report for a single area.",
      monthlyCents: null,
      annualCents: null,
      oneTimeCents: areaReportCents,
      features: ["One area", "Drawn from the public permit and project record"],
    },
    propertyReport: {
      name: "Property Report",
      summary: "A one-time written report for a single property.",
      monthlyCents: null,
      annualCents: null,
      oneTimeCents: propertyReportCents,
      features: ["One property", "Drawn from the public permit and project record"],
    },
  },
} as const;

export type PlanId = keyof typeof pricing.plans;

/** Prices the setup script creates in Stripe. Lookup keys are stable. Ids are not. */
export const stripeCatalog = [
  {
    lookupKey: "area_report",
    productKey: "area_report",
    productName: pricing.plans.areaReport.name,
    nickname: "Area Report",
    unitAmount: areaReportCents,
    interval: null,
    metadata: { kind: "one_time" },
  },
  {
    lookupKey: "property_report",
    productKey: "property_report",
    productName: pricing.plans.propertyReport.name,
    nickname: "Property Report",
    unitAmount: propertyReportCents,
    interval: null,
    metadata: { kind: "one_time" },
  },
  {
    lookupKey: "pro_monthly",
    productKey: "pro",
    productName: pricing.plans.pro.name,
    nickname: "Pro monthly",
    unitAmount: proMonthlyCents,
    interval: "month" as const,
    metadata: { kind: "base" },
  },
  {
    lookupKey: "pro_annual",
    productKey: "pro",
    productName: pricing.plans.pro.name,
    nickname: "Pro annual",
    unitAmount: proMonthlyCents * ANNUAL_MULTIPLIER,
    interval: "year" as const,
    metadata: { kind: "base" },
  },
  {
    lookupKey: "founding_pro_monthly",
    productKey: "founding_pro",
    productName: pricing.plans.founding.name,
    nickname: "Founding Member Pro monthly",
    unitAmount: foundingMonthlyCents,
    interval: "month" as const,
    metadata: {
      kind: "base",
      price_lock: "subscription_lifetime",
      subscriber_cap: String(foundingSubscriberCap),
    },
  },
  {
    lookupKey: "team_monthly",
    productKey: "team",
    productName: pricing.plans.team.name,
    nickname: "Team monthly",
    unitAmount: teamMonthlyCents,
    interval: "month" as const,
    metadata: { kind: "base", included_seats: String(teamIncludedSeats) },
  },
  {
    lookupKey: "team_annual",
    productKey: "team",
    productName: pricing.plans.team.name,
    nickname: "Team annual",
    unitAmount: teamMonthlyCents * ANNUAL_MULTIPLIER,
    interval: "year" as const,
    metadata: { kind: "base", included_seats: String(teamIncludedSeats) },
  },
  {
    lookupKey: "team_seat_monthly",
    productKey: "team",
    productName: pricing.plans.team.name,
    nickname: "Team extra seat monthly",
    unitAmount: extraSeatMonthlyCents,
    interval: "month" as const,
    metadata: { kind: "extra_seat", included_seats: String(teamIncludedSeats) },
  },
  {
    lookupKey: "team_seat_annual",
    productKey: "team",
    productName: pricing.plans.team.name,
    nickname: "Team extra seat annual",
    unitAmount: extraSeatMonthlyCents * ANNUAL_MULTIPLIER,
    interval: "year" as const,
    metadata: { kind: "extra_seat", included_seats: String(teamIncludedSeats) },
  },
] as const;

export type StripeLookupKey = (typeof stripeCatalog)[number]["lookupKey"];
export type StripeCatalogItem = (typeof stripeCatalog)[number];

// stripe-price-ids:start
export const stripePriceIds: Record<StripeLookupKey, string> = {
  area_report: "",
  property_report: "",
  pro_monthly: "",
  pro_annual: "",
  founding_pro_monthly: "",
  team_monthly: "",
  team_annual: "",
  team_seat_monthly: "",
  team_seat_annual: "",
};
// stripe-price-ids:end

const annualPairs: Record<string, StripeLookupKey> = {
  pro_annual: "pro_monthly",
  team_annual: "team_monthly",
  team_seat_annual: "team_seat_monthly",
};

for (const price of stripeCatalog) {
  const monthlyKey = annualPairs[price.lookupKey];
  if (!monthlyKey) continue;
  const monthly = stripeCatalog.find((item) => item.lookupKey === monthlyKey);
  if (!monthly || price.unitAmount !== monthly.unitAmount * ANNUAL_MULTIPLIER) {
    throw new Error(`${price.lookupKey} must be ${ANNUAL_MULTIPLIER} times ${monthlyKey}.`);
  }
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Dollars saved versus twelve monthly payments. */
export function annualSavingsCents(monthlyCents: number): number {
  return monthlyCents * (12 - ANNUAL_MULTIPLIER);
}

/** Billing runtime constants. Kept next to the catalog so checkout and webhooks share one source. */
export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 3;
export const TEAM_MIN_SEATS = teamIncludedSeats;
export const TEAM_MAX_SEATS = 100;
export const INVITE_TTL_DAYS = 7;
export const FOUNDING_SPOTS = foundingSubscriberCap;
export const FOUNDING_GONE = "Founding spots are gone";
export const CONTACT_EMAIL = "renee@lumina.house";

export type Interval = "month" | "year";
export type AccountPlan = "free" | "pro" | "team" | "founding";
export type ReportPlan = "area_report" | "property_report";
export type PurchasablePlan = "pro" | "team" | "founding" | ReportPlan;
export type SubscriptionPlan = "pro" | "team" | "founding";

export function planLabel(plan: string): string {
  switch (plan) {
    case "pro":
      return pricing.plans.pro.name;
    case "team":
      return pricing.plans.team.name;
    case "founding":
      return pricing.plans.founding.name;
    case "area_report":
      return pricing.plans.areaReport.name;
    case "property_report":
      return pricing.plans.propertyReport.name;
    default:
      return pricing.plans.free.name;
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
  if (plan === "area_report") return areaReportCents;
  if (plan === "property_report") return propertyReportCents;
  if (plan === "founding") return foundingMonthlyCents;
  if (plan === "pro") return interval === "year" ? proMonthlyCents * ANNUAL_MULTIPLIER : proMonthlyCents;
  return interval === "year" ? teamMonthlyCents * ANNUAL_MULTIPLIER : teamMonthlyCents;
}

export function seatChargeCents(interval: Interval): number {
  return interval === "year" ? extraSeatMonthlyCents * ANNUAL_MULTIPLIER : extraSeatMonthlyCents;
}

/** Stable Stripe lookup keys from stripeCatalog. */
export function lookupKey(plan: PurchasablePlan, interval: Interval | null): StripeLookupKey {
  if (plan === "area_report" || plan === "property_report") return plan;
  if (plan === "founding") return "founding_pro_monthly";
  if (plan === "pro") return interval === "year" ? "pro_annual" : "pro_monthly";
  return interval === "year" ? "team_annual" : "team_monthly";
}

export function seatLookupKey(interval: Interval): StripeLookupKey {
  return interval === "year" ? "team_seat_annual" : "team_seat_monthly";
}

export function planFromLookup(key: string | null | undefined): {
  plan: PurchasablePlan;
  interval: Interval | null;
} | null {
  switch (key) {
    case "pro_monthly":
      return { plan: "pro", interval: "month" };
    case "pro_annual":
      return { plan: "pro", interval: "year" };
    case "team_monthly":
    case "team_seat_monthly":
      return { plan: "team", interval: "month" };
    case "team_annual":
    case "team_seat_annual":
      return { plan: "team", interval: "year" };
    case "founding_pro_monthly":
      return { plan: "founding", interval: "month" };
    case "area_report":
      return { plan: "area_report", interval: null };
    case "property_report":
      return { plan: "property_report", interval: null };
    default:
      return null;
  }
}

export function reportTypeFor(plan: ReportPlan): "area" | "property" {
  return plan === "area_report" ? "area" : "property";
}

export function recordedPriceId(key: StripeLookupKey): string {
  return stripePriceIds[key]?.trim() ?? "";
}

export const pricingFaq: { q: string; a: string }[] = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Open the billing portal and cancel. Access continues through the period you've already paid, then the account returns to Free. Founding members keep the locked price if they subscribe again.",
  },
  {
    q: "What counts as a search?",
    a: `Each successful nearby search counts as one. A free account gets ${freeSearches} in any rolling ${searchWindowDays} days. Pro, Founding, and Team search without that cap.`,
  },
  {
    q: "How do reports work?",
    a: "Area and property reports are one-time payments. When Stripe confirms payment, Emris stores an entitlement for that target on your account.",
  },
  {
    q: "Annual billing?",
    a: `Annual plans are billed at ${ANNUAL_MULTIPLIER} times the monthly price (two months free). Founding membership is monthly only.`,
  },
];

export const comparison: { feature: string; cells: [string, string, string] }[] = [
  { feature: "Tract scores and map", cells: ["Yes", "Yes", "Yes"] },
  { feature: "Search", cells: [`${freeSearches} / ${searchWindowDays} days`, "Unlimited", "Unlimited"] },
  { feature: "Full permit detail", cells: ["Preview", "Yes", "Yes"] },
  { feature: "IC memos", cells: ["Preview", "Unlimited", "Unlimited"] },
  { feature: "Watchlists and alerts", cells: ["No", "Yes", "Yes"] },
  { feature: "Seats", cells: ["1", "1", `${teamIncludedSeats}+`] },
];
