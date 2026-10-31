"use client";

import { useEffect, useState } from "react";

const AUTH_EVENT = "emris-auth";

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetch("/api/auth/session", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { email?: unknown } | null) => {
          if (cancelled) return;
          setEmail(typeof body?.email === "string" ? body.email : null);
        })
        .catch(() => {
          if (!cancelled) setEmail(null);
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    };
    refresh();
    window.addEventListener(AUTH_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EVENT, refresh);
    };
  }, []);

  return { email, ready };
}

export async function sendMagicLink(email: string, nextPath: string): Promise<void> {
  const res = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, next: nextPath }),
  });
  if (res.status === 429) throw new Error("Too many sign-in attempts. Try again later.");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof body?.error === "string" ? body.error : "Couldn't send the sign-in link.";
    throw new Error(message);
  }
}

export async function signOut(): Promise<void> {
  const res = await fetch("/api/auth/signout", { method: "POST" });
  if (!res.ok) throw new Error("Couldn't sign out.");
  window.dispatchEvent(new Event(AUTH_EVENT));
}
