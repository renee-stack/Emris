export const ROLES = ["Acquisitions", "Development", "Capital", "Asset management", "Other"] as const;
export const STRATEGIES = ["Core", "Value-add", "Development", "Opportunistic"] as const;

export type Role = (typeof ROLES)[number];
export type Strategy = (typeof STRATEGIES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isStrategy(value: string): value is Strategy {
  return (STRATEGIES as readonly string[]).includes(value);
}

export function isValueAdd(strategy: string): boolean {
  return strategy.toLowerCase().includes("value-add");
}
