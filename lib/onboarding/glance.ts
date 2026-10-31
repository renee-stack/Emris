import { getTracts } from "@/lib/data";
import type { TractProps } from "@/lib/data";

export interface GlanceTract {
  geoid: string;
  name: string;
  score: number;
  reason: string;
}

function reason(tract: TractProps): string {
  const direction =
    tract.momentum === "up" ? "Permits are up" : tract.momentum === "down" ? "Permits are down" : "Permits are flat";
  return `${direction} ${tract.momentum_pct}% from the prior year. Score ${tract.score}.`;
}

/** Five strongest tracts in the record we actually have. */
export async function marketGlance(): Promise<GlanceTract[]> {
  const { features } = await getTracts();
  return [...features]
    .sort(
      (a, b) =>
        b.properties.momentum_pct - a.properties.momentum_pct ||
        b.properties.score - a.properties.score,
    )
    .slice(0, 5)
    .map((feature) => ({
      geoid: feature.properties.geoid,
      name: feature.properties.name,
      score: feature.properties.score,
      reason: reason(feature.properties),
    }));
}
