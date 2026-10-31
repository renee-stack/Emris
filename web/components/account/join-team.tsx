"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/marketing/cta";

export function JoinTeam({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6">
      <button
        type="button"
        className={buttonClass}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void fetch("/api/team/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          })
            .then(async (response) => {
              const data = (await response.json()) as { error?: string };
              if (!response.ok) throw new Error(data.error || "Couldn't join the team.");
              router.push("/account/team");
              router.refresh();
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Couldn't join the team.");
              setPending(false);
            });
        }}
      >
        {pending ? "Joining…" : "Join team"}
      </button>
      {error ? (
        <p className="mt-3 text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
