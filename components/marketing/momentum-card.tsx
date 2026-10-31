const COLS = 14;
const ROWS = 9;

type Tone = 1 | 2 | 3 | 4 | 5 | "hot";

const toneClass: Record<Tone, string> = {
  1: "bg-score-1",
  2: "bg-score-2",
  3: "bg-score-3",
  4: "bg-score-4",
  5: "bg-score-5",
  hot: "bg-safety",
};

function toneAt(col: number, row: number): Tone {
  const progress = col / (COLS - 1);
  const center = ROWS - 1 - progress * (ROWS - 2);
  const dist = Math.abs(row - center);
  if ((col === 4 && row === 6) || (col === 8 && row === 4) || (col === 11 && row === 2)) {
    return "hot";
  }
  if (dist < 0.55) return 1;
  if (dist < 1.2) return 2;
  if (dist < 2) return 3;
  if (dist < 2.9) return 4;
  return 5;
}

const cells = Array.from({ length: COLS * ROWS }, (_, index) =>
  toneAt(index % COLS, Math.floor(index / COLS)),
);

const legend = [
  "bg-score-5",
  "bg-score-4",
  "bg-score-3",
  "bg-score-2",
  "bg-score-1",
  "bg-safety",
];

export function MomentumCard() {
  return (
    <figure className="rounded-2xl bg-[color-mix(in_srgb,var(--score-5)_62%,black)] p-4 text-paper shadow-[0_28px_60px_-32px_rgba(14,79,72,0.85)] sm:p-5">
      <figcaption className="sr-only">
        Illustrative choropleth of composite momentum by census tract. Tract
        0412.03 scores 91, top 3 percent, up 14 versus 12 months ago.
      </figcaption>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] text-paper/60">
            METRO · CHICAGO
          </p>
          <p className="mt-1 text-sm font-semibold">Composite momentum by tract</p>
        </div>
        <span className="shrink-0 rounded-full border border-paper/25 px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] text-paper/75">
          ILLUSTRATIVE DATA
        </span>
      </div>
      <div className="relative mt-4">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {cells.map((tone, index) => (
            <span
              key={index}
              className={`aspect-square rounded-[2px] ${toneClass[tone]}`}
            />
          ))}
        </div>
        <div className="relative z-10 mt-4 rounded-xl bg-paper p-4 text-ink shadow-[0_16px_40px_rgba(0,0,0,0.18)] sm:absolute sm:right-1 sm:top-1/2 sm:mt-0 sm:w-56 sm:-translate-y-1/2">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-muted">Tract 0412.03</p>
            <p className="font-mono text-[11px] font-medium tracking-wide text-safety">
              TOP 3%
            </p>
          </div>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-5xl leading-none tracking-tight">
              91
            </span>
            <span className="text-xs text-muted">composite score</span>
          </p>
          <p className="mt-3 text-sm leading-snug">
            Rezoning approved for transit corridor, two 200+ unit permits filed,
            CIP funds a new station.
          </p>
          <p className="mt-3 text-sm font-medium text-teal">
            ▲ +14 vs 12 months ago
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[10px] tracking-[0.14em] text-paper/65">
        <div className="flex items-center gap-2">
          <span>LOW</span>
          <span className="flex gap-0.5" aria-hidden="true">
            {legend.map((swatch) => (
              <span key={swatch} className={`h-2 w-3.5 rounded-[2px] ${swatch}`} />
            ))}
          </span>
          <span>HIGH</span>
        </div>
        <span className="hidden sm:inline">PERCENTILE WITHIN METRO</span>
      </div>
    </figure>
  );
}
