"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const itemClass =
  "text-sm text-ink underline-offset-[6px] hover:text-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal";

const openClass =
  "text-sm text-safety underline decoration-safety decoration-2 underline-offset-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-safety";

export function OpenScoringButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("emris-open-scoring"))}
    >
      How scoring works
    </button>
  );
}

export function SiteTabs() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener("emris-open-scoring", openPanel);
    return () => window.removeEventListener("emris-open-scoring", openPanel);
  }, []);

  return (
    <div className="border-t border-rule">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5" role="tablist" aria-label="Emris">
          <Link href="/access" className={itemClass} role="tab">
            Request access
          </Link>
          <Link href="/map" className={itemClass} role="tab">
            Test it out
          </Link>
          <button
            type="button"
            role="tab"
            id="how-scoring-tab"
            className={open ? openClass : itemClass}
            aria-selected={open}
            aria-expanded={open}
            aria-controls="how-scoring"
            onClick={() => setOpen((value) => !value)}
          >
            How scoring works
          </button>
        </div>
        {open ? (
          <p id="how-scoring" role="tabpanel" aria-labelledby="how-scoring-tab" className="max-w-xl pb-4 text-sm leading-relaxed text-ink/80">
            Message with Photon. Ask us about a tract, an address, or where permits are heating up. We answer from the public filings.
          </p>
        ) : null}
      </div>
    </div>
  );
}
