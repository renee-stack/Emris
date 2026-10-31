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
