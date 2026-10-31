"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus, X } from "lucide-react";
import type {
  Momentum,
  NearResponse,
  ProjectStatus,
  ProjectWithDistance,
  TractDetailResponse,
  TractProps,
} from "@/lib/data";
import AccountPrompt from "@/components/AccountPrompt";
import { ApiError, fetchTract } from "@/components/load";
import { coverageLabel, searchLimitMessage } from "@/components/places";
import { STATUS_LABEL, formatMiles, formatMomentumPct, formatMonth } from "@/lib/spatial";

export interface SearchState {
  status: "loading" | "ready" | "error" | "limited";
  place: { lat: number; lng: number; zoom: number } | null;
  result: NearResponse | null;
  error: string | null;
  resets: string | null;
}

interface Props {
  open: boolean;
  mode: "tract" | "search" | "account" | null;
  geoid: string | null;
  summary: TractProps | null;
  placeName: string | null;
  coverageSources: unknown[];
  signedIn: boolean;
  authReady: boolean;
  search: SearchState | null;
  onClose: () => void;
  onOpenTract: (geoid: string) => void;
  onProjects: (projects: ProjectWithDistance[]) => void;
  onGenerateMemo: (info: { geoid: string; name: string; score: number }) => void;
}

const SIGNALS: { key: "mf_permits" | "permit_momentum" | "infra_proximity"; label: string }[] = [
  { key: "mf_permits", label: "Multifamily permits" },
  { key: "permit_momentum", label: "Permit momentum" },
  { key: "infra_proximity", label: "Infrastructure catalysts" },
];

function MomentumIcon({ momentum }: { momentum: Momentum }) {
  if (momentum === "up") return <ArrowUp className="h-4 w-4 text-teal" aria-label="Up" />;
  if (momentum === "down") return <ArrowDown className="h-4 w-4 text-safety" aria-label="Down" />;
  return <Minus className="h-4 w-4 text-muted" aria-label="Flat" />;
}

function StatusChip({ status }: { status: ProjectStatus }) {
  const tone = {
    planned: "bg-[#ececec] text-ink",
    funded: "border border-teal-mid text-teal-mid",
    under_construction: "bg-safety text-paper",
    complete: "bg-teal text-paper",
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[11px] leading-4 ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function CoverageBadge({ label }: { label: string }) {
  return (
    <p className="mt-3 inline-flex rounded-full border border-rule px-2 py-0.5 font-sans text-[11px] leading-4 text-muted">
      {label}
    </p>
  );
}

function Bones() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-1.5 w-2/3 rounded-full bg-ink/10" />
      <div className="h-1.5 w-full rounded-full bg-ink/10" />
      <div className="h-1.5 w-5/6 rounded-full bg-ink/10" />
      <div className="h-1.5 w-1/2 rounded-full bg-ink/10" />
    </div>
  );
}

function unitsLabel(units: number | null): string {
  if (units == null) return "Units not reported";
  return units === 1 ? "1 unit" : `${units} units`;
}

function rankLine(percentile: number, placeName: string | null): string {
  const top = `Top ${Math.max(0, 100 - percentile)}%`;
  return placeName ? `${top} in ${placeName}` : top;
}

export default function SidePanel({
  open,
  mode,
  geoid,
  summary,
  placeName,
  coverageSources,
  signedIn,
  authReady,
  search,
  onClose,
  onOpenTract,
  onProjects,
  onGenerateMemo,
}: Props) {
  const [detail, setDetail] = useState<TractDetailResponse | null>(null);
  const [error, setError] = useState<{ geoid: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn || mode !== "tract" || !geoid) return;
    let cancelled = false;
    const requested = geoid;
    void fetchTract(requested)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        onProjects(next.nearby_projects);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          geoid: requested,
          message:
            err instanceof ApiError && err.status === 404
              ? "We couldn't find that tract."
              : "Couldn't load this tract.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, mode, geoid, attempt, onProjects]);

  const shown = detail && detail.tract.geoid === geoid ? detail : null;
  const tract = shown?.tract;
  const tractError = error && error.geoid === geoid ? error.message : null;
  const badge = coverageLabel(summary, shown?.tract, ...coverageSources);

  return (
    <aside
      inert={!open}
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-30 flex w-[400px] flex-col border-l border-rule bg-paper text-ink transition-transform duration-300 ease ${
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-ink/5"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5">
        {mode === "tract" && !authReady ? (
          <div className="space-y-6 pr-8 pt-8">
            <Bones />
            <Bones />
          </div>
        ) : null}
        {mode === "tract" && authReady && !signedIn ? (
          <ScoreOnly summary={summary} badge={badge} />
        ) : null}
        {mode === "account" && authReady && !signedIn ? (
          <div className="pr-8 pt-8">
            <AccountPrompt />
          </div>
        ) : null}
        {mode === "tract" && authReady && signedIn ? (
          <TractBody
            loading={!shown && !tractError}
            error={tractError}
            detail={shown}
            placeName={placeName}
            badge={badge}
            onRetry={() => {
              setDetail(null);
              setError(null);
              setAttempt((value) => value + 1);
            }}
          />
        ) : null}
        {mode === "search" && search && signedIn ? (
          <SearchBody search={search} onOpenTract={onOpenTract} />
        ) : null}
      </div>
      {mode === "tract" && signedIn && tract ? (
        <footer className="shrink-0 border-t border-rule p-4">
          <button
            type="button"
            className="h-12 w-full bg-safety font-sans text-sm font-medium text-paper"
            onClick={() =>
              onGenerateMemo({ geoid: tract.geoid, name: tract.name, score: tract.score })
            }
          >
            Generate IC memo
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

function ScoreOnly({ summary, badge }: { summary: TractProps | null; badge: string }) {
  if (!summary) {
    return <p className="pr-8 pt-8 font-sans text-sm text-ink">We couldn&apos;t find that tract.</p>;
  }
  return (
    <div className="pr-8">
      <h2 className="font-display text-[26px] leading-tight text-ink">{summary.name}</h2>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-mono text-5xl leading-none">{summary.score}</span>
        <span className="font-mono text-lg text-muted">/100</span>
      </div>
      <CoverageBadge label={badge} />
      <AccountPrompt />
    </div>
  );
}

function TractBody({
  loading,
  error,
  detail,
  placeName,
  badge,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  detail: TractDetailResponse | null;
  placeName: string | null;
  badge: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="pr-8 pt-6">
        <p className="font-sans text-sm text-ink">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 font-sans text-sm text-ink underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }
  if (loading || !detail) {
    return (
      <div className="space-y-6 pr-8 pt-8">
        <Bones />
        <Bones />
        <Bones />
      </div>
    );
  }
  const tract = detail.tract;
  return (
    <div className="pr-8">
      <h2 className="font-display text-[26px] leading-tight text-ink">{tract.name}</h2>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-mono text-5xl leading-none">{tract.score}</span>
        <span className="font-mono text-lg text-muted">/100</span>
      </div>
      <p className="mt-1 font-sans text-sm text-ink">{rankLine(tract.percentile, placeName)}</p>
      <CoverageBadge label={badge} />
      <div className="mt-3 flex items-center gap-2 font-sans text-sm">
        <MomentumIcon momentum={tract.momentum} />
        <span>{formatMomentumPct(tract.momentum_pct)} vs prior 12 mo</span>
      </div>

      <section className="mt-8">
        <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Signals
        </h3>
        <div className="mt-3 space-y-3">
          {SIGNALS.map((signal) => {
            const value = tract.signals[signal.key];
            return (
              <div key={signal.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-sans text-sm">{signal.label}</span>
                  <span className="font-mono text-sm">{value}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-rule">
                  <div
                    className="h-full rounded-full bg-teal-mid"
                    style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Recent multifamily permits
        </h3>
        <p className="mt-2 font-sans text-sm text-ink">
          {tract.permit_count_24mo} permits · {tract.units_24mo} units in the last 24 months
        </p>
        {detail.top_permits.length === 0 ? (
          <p className="mt-3 font-sans text-sm text-muted">
            No multifamily permits filed here in the last 24 months.
          </p>
        ) : (
          <ul className="mt-2">
            {detail.top_permits.map((permit) => (
              <li key={permit.id} className="border-t border-rule py-3">
                <div className="break-words font-mono text-sm">{permit.address}</div>
                <div className="mt-0.5 font-sans text-xs text-muted">
                  {unitsLabel(permit.units)} · {formatMonth(permit.issue_date)}
                </div>
                <p className="mt-1 line-clamp-2 font-sans text-sm leading-snug">{permit.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Nearby catalysts
        </h3>
        {detail.nearby_projects.length === 0 ? (
          <p className="mt-3 font-sans text-sm text-muted">
            No infrastructure projects within a mile of this tract.
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {detail.nearby_projects.map((project) => (
              <li key={project.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 font-sans text-sm leading-snug">{project.name}</div>
                  <div className="shrink-0 font-mono text-xs text-muted">
                    {formatMiles(project.distance_mi)}
                  </div>
                </div>
                <div className="mt-1">
                  <StatusChip status={project.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SearchBody({
  search,
  onOpenTract,
}: {
  search: SearchState;
  onOpenTract: (geoid: string) => void;
}) {
  if (search.status === "limited") {
    return (
      <div className="pr-8 pt-8">
        <p className="font-sans text-sm text-ink">{searchLimitMessage(search.resets)}</p>
        <button
          type="button"
          className="mt-4 h-12 w-full bg-safety font-sans text-sm font-medium text-paper"
          onClick={() => undefined}
        >
          Upgrade
        </button>
      </div>
    );
  }
  if (search.status === "error") {
    return <p className="pr-8 pt-8 font-sans text-sm text-ink">{search.error}</p>;
  }
  const result = search.result;
  const label =
    result?.place.label ??
    (search.place ? `${search.place.lat.toFixed(4)}, ${search.place.lng.toFixed(4)}` : "Searching");
  return (
    <div className="pr-8">
      <h2 className="font-display text-[26px] leading-tight">{label}</h2>
      {search.status === "loading" || !result ? (
        <div className="mt-6">
          <Bones />
        </div>
      ) : (
        <>
          {result.tract ? (
            <button
              type="button"
              onClick={() => onOpenTract(result.tract!.geoid)}
              className="mt-5 w-full rounded-md border border-rule p-3 text-left hover:bg-ink/[0.03]"
            >
              <div className="font-display text-lg leading-tight">{result.tract.name}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm">{result.tract.score}</span>
                <MomentumIcon momentum={result.tract.momentum} />
                <span className="font-sans text-xs text-muted">
                  {formatMomentumPct(result.tract.momentum_pct)} vs prior 12 mo
                </span>
              </div>
            </button>
          ) : (
            <p className="mt-4 font-sans text-sm text-muted">
              This point isn&apos;t inside a scored tract.
            </p>
          )}
          <section className="mt-8">
            <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
              Permits within 1/4 mile
            </h3>
            {result.permits.length === 0 ? (
              <p className="mt-3 font-sans text-sm text-muted">No permits filed within 1/4 mile.</p>
            ) : (
              <ul className="mt-2">
                {result.permits.map((permit) => (
                  <li key={permit.id} className="border-t border-rule py-3">
                    <div className="break-words font-mono text-sm">{permit.address}</div>
                    <div className="mt-0.5 font-sans text-xs text-muted">
                      {unitsLabel(permit.units)} · {formatMonth(permit.issue_date)}
                    </div>
                    <p className="mt-1 line-clamp-2 font-sans text-sm leading-snug">
                      {permit.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="mt-8">
            <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
              Catalysts nearby
            </h3>
            {result.projects.length === 0 ? (
              <p className="mt-3 font-sans text-sm text-muted">
                No infrastructure projects within 1/4 mile.
              </p>
            ) : (
              <ul className="mt-3 space-y-4">
                {result.projects.map((project) => (
                  <li key={project.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 font-sans text-sm leading-snug">{project.name}</div>
                      <div className="shrink-0 font-mono text-xs text-muted">
                        {formatMiles(project.distance_mi)}
                      </div>
                    </div>
                    <div className="mt-1">
                      <StatusChip status={project.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
