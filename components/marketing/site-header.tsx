import Link from "next/link";
import { Cta } from "./cta";
import { Mark } from "./mark";

export type MarketingSection = "home" | "platform" | "pricing" | "access";

const links = [
  { href: "/platform", id: "platform", label: "Platform" },
  { href: "/pricing", id: "pricing", label: "Pricing" },
] as const;

function navClass(active: boolean) {
  return active
    ? "text-sm text-safety underline decoration-safety decoration-2 underline-offset-[6px]"
    : "text-sm text-ink hover:text-teal";
}

export function SiteHeader({ current }: { current?: MarketingSection }) {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-xl leading-none tracking-tight">
            Emris
          </span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className={navClass(current === link.id)}
              aria-current={current === link.id ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4 sm:gap-5">
          <Link href="/map" className="hidden text-sm text-ink hover:text-teal sm:inline">
            Test it out
          </Link>
          <Cta
            href="/access"
            variant={current === "access" ? "safety" : "ink"}
            className="px-3.5 py-2"
          >
            Request access
          </Cta>
        </div>
      </div>
      <nav
        className="mx-auto flex max-w-6xl gap-5 px-5 pb-3 md:hidden"
        aria-label="Primary"
      >
        {links.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className={navClass(current === link.id)}
            aria-current={current === link.id ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
        <Link href="/map" className="text-sm text-ink hover:text-teal">
          Test it out
        </Link>
      </nav>
    </header>
  );
}
