"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { fetchMemo } from "@/components/load";

interface Props {
  geoid: string;
  name: string;
  score: number;
  onClose: () => void;
}

type Status = "loading" | "ready" | "error";

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function MemoModal({ geoid, name, score, onClose }: Props) {
  const [memo, setMemo] = useState<{ geoid: string; title: string; markdown: string } | null>(null);
  const [failedGeoid, setFailedGeoid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const date = todayLabel();
  const ready = memo?.geoid === geoid ? memo : null;
  const failed = failedGeoid === geoid;
  const status: Status = ready ? "ready" : failed ? "error" : "loading";

  useEffect(() => {
    let cancelled = false;
    const requested = geoid;
    void fetchMemo(requested)
      .then((next) => {
        if (cancelled) return;
        setMemo({ geoid: requested, title: next.title, markdown: next.memo_markdown });
      })
      .catch(() => {
        if (!cancelled) setFailedGeoid(requested);
      });
    return () => {
      cancelled = true;
    };
  }, [geoid, attempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(ready.markdown);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-title"
        className="memo-sheet my-auto w-full max-w-[720px] bg-paper text-ink shadow-xl"
      >
        <header className="px-10 pt-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            Emris · Investment Committee Brief
          </p>
          {status === "ready" && ready ? (
            <h2 id="memo-title" className="mt-3 font-display text-[32px] leading-tight">
              {ready.title}
            </h2>
          ) : (
            <div id="memo-title" className="mt-4 h-8 w-4/5 rounded-full bg-ink/10" />
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-sans text-sm">
            <span>{name}</span>
            <span className="text-muted">{date}</span>
            <span>Path-of-progress score: {score}/100</span>
          </div>
        </header>
        <hr className="mx-10 mt-6 border-rule" />
        <div className="px-10 py-6 font-sans text-base leading-[1.6]">
          {status === "loading" ? (
            <div className="animate-pulse space-y-5">
              {[0, 1, 2].map((block) => (
                <div key={block} className="space-y-2">
                  <div className="h-1.5 w-36 rounded-full bg-ink/10" />
                  <div className="h-1.5 w-full rounded-full bg-ink/10" />
                  <div className="h-1.5 w-11/12 rounded-full bg-ink/10" />
                  <div className="h-1.5 w-4/5 rounded-full bg-ink/10" />
                </div>
              ))}
              <p className="font-sans text-sm text-muted">Reading permits and filings...</p>
            </div>
          ) : null}
          {status === "error" ? (
            <div>
              <p>Couldn&apos;t generate the memo. Try again.</p>
              <button
                type="button"
                onClick={() => {
                  setMemo(null);
                  setFailedGeoid(null);
                  setAttempt((value) => value + 1);
                }}
                className="memo-no-print mt-3 border border-rule px-3 py-1.5 font-sans text-sm"
              >
                Try again
              </button>
            </div>
          ) : null}
          {status === "ready" ? (
            <ReactMarkdown
              components={{
                h2: ({ children }) => (
                  <h2 className="mb-2 mt-8 font-display text-[22px] leading-tight first:mt-0">
                    {children}
                  </h2>
                ),
                p: ({ children }) => <p className="mb-3">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
              }}
            >
              {ready?.markdown ?? ""}
            </ReactMarkdown>
          ) : null}
        </div>
        <footer className="memo-no-print flex justify-end gap-3 border-t border-rule px-10 py-4">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={status !== "ready"}
            className="border border-rule px-4 py-2 font-sans text-sm disabled:text-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={status !== "ready"}
            className="border border-ink bg-ink px-4 py-2 font-sans text-sm text-paper disabled:opacity-40"
          >
            Print
          </button>
        </footer>
      </article>
    </div>
  );
}
