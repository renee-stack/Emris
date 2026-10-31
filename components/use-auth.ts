"use client";

import { useEffect, useState } from "react";
import { supabaseEnv } from "@/lib/supabase/env";

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const configured = supabaseEnv() !== null;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { user?: { email?: string | null } | null }) => {
        if (cancelled) return;
        setEmail(body.user?.email ?? null);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { email, ready, configured };
}

export async function sendMagicLink(email: string, nextPath: string): Promise<void> {
  const res = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, next: nextPath }),
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error || "Couldn't send the sign-in link.");
}

export async function signOut(): Promise<void> {
  const res = await fetch("/api/auth/signout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "local" }),
  });
  if (!res.ok) throw new Error("Couldn't sign out.");
}
