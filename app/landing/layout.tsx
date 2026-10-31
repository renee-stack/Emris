import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Emris — See the path of progress",
    template: "%s — Emris",
  },
  description:
    "Permit and construction intelligence for multifamily. Emris reads public filings for every census tract in a metro, scores the momentum, and writes it up for investment committee.",
};

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto scroll-smooth bg-paper text-ink">
      {children}
    </div>
  );
}
