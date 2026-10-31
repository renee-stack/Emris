import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type MarketingSection } from "./site-header";

export const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";
export const band = "bg-[color-mix(in_srgb,var(--ink)_4%,var(--paper))]";

export function MarketingShell({
  current,
  children,
}: {
  current?: MarketingSection;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader current={current} />
      {children}
      <SiteFooter />
    </>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-safety uppercase">
      {children}
    </p>
  );
}
