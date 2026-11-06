import Link from "next/link";
import { buttonClass } from "@/components/marketing/cta";

export function SignIn({ next, title = "Sign in to continue" }: { next: string; title?: string }) {
  const href = `/signin?next=${encodeURIComponent(next)}`;
  return (
    <div className="rounded-2xl border border-rule p-6">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Use the same email you sign in with on Emris. Checkout starts after you&apos;re signed in.
      </p>
      <Link href={href} className={`${buttonClass} mt-5`}>
        Sign in
      </Link>
    </div>
  );
}
