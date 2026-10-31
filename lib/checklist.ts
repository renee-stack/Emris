export const CHECKS = {
  tract: "emris-check-tract",
  search: "emris-check-search",
  watch: "emris-check-watch",
  memo: "emris-check-memo",
} as const;

export type CheckId = keyof typeof CHECKS;

export const CHECK_LABELS: { id: CheckId; label: string }[] = [
  { id: "tract", label: "Explore a tract" },
  { id: "search", label: "Run your first search" },
  { id: "watch", label: "Save a watch area" },
  { id: "memo", label: "Generate an investment committee memo preview" },
];

export function markCheck(id: CheckId) {
  try {
    localStorage.setItem(CHECKS[id], "1");
  } catch {
    // Ignore private-mode storage failures.
  }
}

export function readChecks(): Record<CheckId, boolean> {
  const done = { tract: false, search: false, watch: false, memo: false };
  try {
    (Object.keys(CHECKS) as CheckId[]).forEach((id) => {
      done[id] = localStorage.getItem(CHECKS[id]) === "1";
    });
  } catch {
    // Ignore private-mode storage failures.
  }
  return done;
}

export function saveWatchArea(name: string) {
  try {
    localStorage.setItem("emris-watch-area", name);
  } catch {
    // Ignore private-mode storage failures.
  }
  markCheck("watch");
}
