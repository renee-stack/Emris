import Link from "next/link";
import { Mark } from "./mark";

const links = [
  { href: "/platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/access", label: "Request access" },
  { href: "/map", label: "Test it out" },
];

export function SiteFooter() {
  return (
    <footer className="bg-[color-mix(in_srgb,var(--score-5)_68%,black)] text-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 sm:px-8 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark className="size-7" />
          <span className="font-display text-lg leading-none tracking-tight">
            Emris
          </span>
        </Link>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-paper/80 hover:text-paper"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-paper/70">
          © 2026 Emris. Public-record data, independently scored.
        </p>
      </div>
    </footer>
  );
}
