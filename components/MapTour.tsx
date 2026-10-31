"use client";

import { useState } from "react";

const TIPS = [
  {
    title: "Tract colors",
    body: "Darker green means a higher path-of-progress score.",
  },
  {
    title: "Coverage badge",
    body: "The badge names which signals are in the score, and which are still missing.",
  },
  {
    title: "Search",
    body: "Search an address or a neighborhood once you are signed in.",
  },
];

const STORAGE_KEY = "emris-tour-dismissed";

export default function MapTour() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const tip = TIPS[step];
  if (!tip) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignore private-mode storage failures.
    }
    setOpen(false);
  }

  return (
    <div className="absolute bottom-4 left-4 z-20 w-[min(320px,calc(100vw-2rem))] rounded-lg border border-rule bg-paper p-4 shadow-md">
      <p className="font-mono text-[11px] tracking-[0.16em] text-safety">
        {step + 1} OF {TIPS.length}
      </p>
      <h2 className="mt-2 font-display text-2xl tracking-tight">{tip.title}</h2>
      <p className="mt-2 font-sans text-sm leading-relaxed text-ink">{tip.body}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={dismiss} className="font-sans text-sm text-muted underline underline-offset-2">
          Dismiss
        </button>
        {step < TIPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((value) => value + 1)}
            className="rounded-md bg-ink px-3 py-2 font-sans text-sm font-medium text-paper"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md bg-ink px-3 py-2 font-sans text-sm font-medium text-paper"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

export function tourRequested(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") !== "1") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}
