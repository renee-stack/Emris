import Link from "next/link";
import type { ReactNode } from "react";

const base =
  "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2";

const variants = {
  safety: "bg-safety text-paper focus-visible:outline-safety",
  ink: "bg-ink text-paper focus-visible:outline-ink",
  outline:
    "border border-ink/25 bg-paper text-ink hover:border-ink focus-visible:outline-ink",
  outlineLight:
    "border border-paper/40 text-paper hover:border-paper focus-visible:outline-paper",
} as const;

export function Cta({
  href,
  children,
  variant = "safety",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export const buttonClass = `${base} ${variants.safety}`;
