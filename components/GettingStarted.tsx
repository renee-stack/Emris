"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CHECK_LABELS, readChecks, saveWatchArea, type CheckId } from "@/lib/checklist";

export default function GettingStarted({ placeName }: { placeName?: string | null }) {
  const [done, setDone] = useState<Record<CheckId, boolean>>({
    tract: false,
    search: false,
    watch: false,
    memo: false,
  });

  useEffect(() => {
    setDone(readChecks());
  }, []);

  return (
    <section>
      <h2 className="font-display text-2xl tracking-tight">Getting started</h2>
      <ul className="mt-4 space-y-2">
        {CHECK_LABELS.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <span aria-hidden="true">{done[item.id] ? "✓" : "○"}</span>
            <span>
              {item.label}
              <span className="sr-only">{done[item.id] ? ", done" : ", not yet"}</span>
            </span>
          </li>
        ))}
      </ul>
      {placeName ? (
        <button
          type="button"
          className="mt-4 font-sans text-sm text-ink underline underline-offset-2"
          onClick={() => {
            saveWatchArea(placeName);
            setDone(readChecks());
          }}
        >
          Save {placeName} as a watch area
        </button>
      ) : null}
      <Link href="/account" className="mt-4 block font-sans text-sm text-ink underline underline-offset-2">
        Account
      </Link>
    </section>
  );
}
