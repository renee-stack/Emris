import type { ReactNode } from "react";
import Link from "next/link";
import { Mark } from "@/components/marketing/mark";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark className="size-7" />
            <span className="font-display text-xl leading-none tracking-tight">Emris</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm" aria-label="Account">
            <Link href="/account/billing" className="hover:text-teal">
              Billing
            </Link>
            <Link href="/account/team" className="hover:text-teal">
              Team
            </Link>
            <Link href="/pricing" className="hover:text-teal">
              Plans
            </Link>
            <Link href="/map" className="hover:text-teal">
              Map
            </Link>
          </nav>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
