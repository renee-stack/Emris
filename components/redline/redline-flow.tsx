"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Eyebrow, container } from "@/components/marketing/shell";

// The Redline customer flow: drop a letter, check what was read, see a free preview, unlock the rest.
// Everything goes through /api/redline, and the service decides what's locked. See contract.md §2.7.

interface Comment {
  id: string;
  heading: string;
  text: string;
}
interface Flag {
  level: "review" | "info";
  action: string;
  message: string;
  before?: string;
}
interface Item {
  comment: string;
  text: string;
  heading: string;
  route: string;
  discipline: string;
  sheets: string[];
  locked: boolean;
  citation: string | null;
  draft: string;
  decision: "approve" | "reject" | null;
  flags?: Flag[];
}
interface Report {
  id: string;
  place: string;
  jurisdiction: string;
  permit_number: string | null;
  unlocked: boolean;
  learning_opt_in: boolean;
  counts: Record<string, number>;
  items: Item[];
}
interface Offer {
  payments: boolean;
  price: string;
  places: { id: string; name: string }[];
}
type Stage = "drop" | "check" | "working" | "stop" | "report";

const ROUTES: Record<string, [string, string]> = {
  licensed_review: ["Needs your architect or engineer", "Held until a licensed professional signs off"],
  other_agency: ["Another agency", "The next step is outside this plan review"],
  client_input: ["Needs the owner or a consultant", "A fact or document only they have"],
  agent_draft: ["Routine paperwork", "Prepared for your sign-off"],
  no_action: ["No response needed", ""],
};

const MAX_FILE_BYTES = 3_000_000;
const field = "w-full rounded-lg border border-rule bg-paper px-3 py-2 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal";
const quiet = "rounded-lg border border-rule bg-paper px-3.5 py-2 text-sm text-ink hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal";
const primary = "rounded-lg bg-ink px-5 py-2.5 text-[15px] font-semibold text-paper hover:bg-ink/85 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal";
const textLink = "text-sm text-muted underline underline-offset-4 hover:text-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal";

async function api<T>(path: string, payload?: unknown): Promise<T> {
  const res = await fetch(`/api/redline/${path}`, payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
  return body as T;
}

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function FlagNote({ flag }: { flag: Flag }) {
  return (
    <p className={`mt-2 rounded border-l-2 px-2 py-1 text-[13px] ${flag.level === "review" ? "border-safety bg-safety/5 text-ink" : "border-rule text-muted"}`}>
      {flag.level === "review" && <b>Check: </b>}
      {flag.message}
      {flag.before && (flag.action === "rewritten" || flag.action === "removed") && <span className="mt-0.5 block text-muted">Original: {flag.before}</span>}
    </p>
  );
}

function ItemCard({ item, unlocked, onDecide }: { item: Item; unlocked: boolean; onDecide: (decision: "approve" | "reject", note: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const held = item.route === "licensed_review";
  const edge = item.decision === "approve" ? "border-l-teal" : item.decision === "reject" ? "border-l-safety" : held ? "border-l-ink" : "border-l-rule";
  return (
    <article className={`mb-2 rounded-lg border border-l-[3px] border-rule bg-paper p-4 ${edge}`}>
      <div className="flex flex-wrap gap-1.5 font-mono text-[11px] text-muted">
        {[item.comment, item.discipline, ...item.sheets].map((tag) => (
          <span key={tag} className="rounded bg-ink/5 px-1.5 py-0.5">{tag}</span>
        ))}
      </div>
      <p className="mt-2 text-sm leading-relaxed break-words text-muted">{item.text}</p>
      {item.flags?.map((flag, i) => <FlagNote key={i} flag={flag} />)}
      {item.locked ? (
        <p className="mt-2 text-sm text-muted italic">Draft and citation unlock with this permit.</p>
      ) : (
        <>
          {item.citation && <p className="mt-2 font-mono text-[13px] font-medium">{item.citation}</p>}
          {item.draft && <p className="mt-2 text-[15px] leading-relaxed">{item.draft}</p>}
        </>
      )}
      {unlocked && item.route !== "no_action" && !item.locked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.decision ? (
            <span className={`text-sm font-semibold ${item.decision === "approve" ? "text-teal" : "text-safety"}`}>{item.decision === "approve" ? "Approved" : "Rejected"}</span>
          ) : rejecting ? (
            <>
              <input aria-label="Reject note" placeholder="What's wrong with it?" value={note} onChange={(e) => setNote(e.target.value)} className={`${field} min-w-48 flex-1`} autoFocus />
              <button type="button" className={quiet} onClick={() => onDecide("reject", note.trim())}>Send</button>
            </>
          ) : (
            <>
              <button type="button" className={quiet} onClick={() => onDecide("approve", "")}>{held ? "Approve as licensed reviewer" : "Approve"}</button>
              <button type="button" className={quiet} onClick={() => setRejecting(true)}>Reject</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function RedlineFlow() {
  const params = useParams<{ id?: string }>();
  const search = useSearchParams();
  const reportId = params.id;

  const [offer, setOffer] = useState<Offer | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(reportId ? "working" : "drop");
  const [comments, setComments] = useState<Comment[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [nextRound, setNextRound] = useState<{ from: string; permit: string | null; place: string } | null>(null);
  const [place, setPlace] = useState("other");
  const [permit, setPermit] = useState("");
  const [edition2026, setEdition2026] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(search.get("payment") === "failed" ? "We couldn't confirm that payment. If your card was charged, email us." : null);
  const [stopMessage, setStopMessage] = useState("");
  const [email, setEmail] = useState("");
  const [waitDone, setWaitDone] = useState(false);
  const [partner, setPartner] = useState(false);
  const [copied, setCopied] = useState("");
  const top = useRef<HTMLDivElement>(null);

  const goTo = useCallback((next: Stage) => {
    setStage(next);
    top.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    let live = true;
    api<Offer>("offer")
      .then((o) => live && setOffer(o))
      .catch((e: Error) => live && setUnavailable(e.message));
    if (reportId) {
      api<Report>(`report/${reportId}`)
        .then((r) => {
          if (!live) return;
          setReport(r);
          setStage("report");
        })
        .catch((e: Error) => {
          if (!live) return;
          setError(e.message);
          setStage("drop");
        });
    }
    return () => {
      live = false;
    };
  }, [reportId]);

  function accept(x: { error?: string; comments?: Comment[]; warnings?: string[]; jurisdiction?: string | null; permit_number?: string | null }) {
    if (x.error) {
      setError(x.error);
      setPasting(true);
      return;
    }
    if (!x.comments?.length) {
      setError("We couldn't find comments in that. Paste the comments instead, one per paragraph.");
      setPasting(true);
      return;
    }
    setComments(x.comments);
    setWarnings(x.warnings ?? []);
    setPlace(nextRound?.place ?? x.jurisdiction ?? "other");
    setPermit(nextRound?.permit ?? x.permit_number ?? "");
    goTo("check");
  }

  async function readFile(file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 3 MB. Paste the comments instead.");
      setPasting(true);
      return;
    }
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        accept(await api("start/extract", { pdf_base64: toBase64(new Uint8Array(await file.arrayBuffer())) }));
      } else if (/\.docx$/i.test(file.name) || file.type === DOCX_TYPE) {
        accept(await api("start/extract", { docx_base64: toBase64(new Uint8Array(await file.arrayBuffer())) }));
      } else if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
        accept(await api("start/extract", { text: await file.text() }));
      } else if (/\.doc$/i.test(file.name)) {
        setError("This is an older Word file. In Word, use Save As to save it as .docx or PDF, or paste the comments.");
        setPasting(true);
      } else {
        setError("We read PDF, Word (.docx) and text files. Paste the comments instead.");
        setPasting(true);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    setError(null);
    goTo("working");
    try {
      const { job_id } = await api<{ job_id: string }>("start/run", { comments, from_report: nextRound?.from, jurisdiction: place, permit_number: permit, chicago_2026: place === "chicago" && edition2026 });
      let job = await api<{ status: string; result?: Report & { stop?: string; message?: string } }>(`job/${job_id}`);
      while (job.status === "running") {
        await new Promise((r) => setTimeout(r, 1500));
        job = await api(`job/${job_id}`);
      }
      const result = job.result!;
      if (result.stop) {
        setStopMessage(result.message ?? "");
        setWaitDone(false);
        goTo("stop");
      } else {
        setReport(result);
        setStage("report");
        top.current?.scrollIntoView();
        // A router navigation would keep this page mounted but hidden behind the report page (see the Next
        // cacheComponents docs), leaving a stale copy of the flow. Changing only the URL keeps one copy.
        window.history.replaceState(null, "", `/redline/r/${result.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
      goTo("check");
    }
  }

  async function unlock() {
    if (!report || !offer) return;
    setError(null);
    if (!offer.payments && !partner) return setError("Tick the box above to continue.");
    try {
      const res = await api<Report & { checkout_url?: string }>(`report/${report.id}/unlock`, { design_partner: !offer.payments });
      if (res.checkout_url) window.location.href = res.checkout_url;
      else setReport(res);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function decide(item: Item, decision: "approve" | "reject", note: string) {
    if (!report) return;
    try {
      setReport(await api<Report>(`report/${report.id}/review`, { comment: item.comment, decision, note }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function setOptIn(value: boolean) {
    if (!report) return;
    try {
      setReport(await api<Report>(`report/${report.id}/optin`, { opt_in: value }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("Link copied");
    } catch {
      setCopied(window.location.href);
    }
  }

  async function joinWaitlist() {
    setError(null);
    try {
      await api("waitlist", { email, place, reason: edition2026 ? "edition" : "uncovered" });
      setWaitDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startNextRound() {
    if (!report) return;
    setNextRound({ from: report.id, permit: report.permit_number, place: report.jurisdiction });
    setComments([]);
    setWarnings([]);
    setReport(null);
    setPasted("");
    setError(null);
    window.history.pushState(null, "", "/redline");
    goTo("drop");
  }

  function restart() {
    setNextRound(null);
    setWarnings([]);
    setComments([]);
    setReport(null);
    setPasted("");
    setError(null);
    window.history.pushState(null, "", "/redline");
    goTo("drop");
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const errorLine = error && <p role="alert" className="mt-3 text-sm text-safety">{error}</p>;
  const lockedCount = report?.items.filter((i) => i.locked).length ?? 0;

  return (
    <section className={`${container} max-w-3xl py-12 lg:py-16`} ref={top}>
      <Eyebrow>Redline by Emris</Eyebrow>

      {stage === "drop" && (
        <>
          <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight sm:text-5xl">Answer your correction letter in minutes</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">{nextRound ? `Add the next letter${nextRound.permit ? ` on permit ${nextRound.permit}` : ""}. It's included with this permit.` : "Drop in the letter. See every comment sorted, with who needs to act, before you pay anything. No signup."}</p>
          {unavailable ? (
            <p role="alert" className="mt-8 rounded-lg border border-rule p-4 text-sm text-muted">{unavailable}</p>
          ) : (
            <>
              <label
                htmlFor="redline-file"
                className={`mt-8 block cursor-pointer rounded-xl border-2 border-dashed bg-paper px-4 py-12 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal hover:border-teal ${over ? "border-teal" : "border-rule"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <span className="block text-lg font-semibold">Drop your correction letter</span>
                <span className="text-sm text-muted">PDF or Word up to 3 MB, or choose a file</span>
                <input id="redline-file" type="file" accept=".pdf,.docx,.doc,.txt,application/pdf,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              </label>
              {!pasting && (
                <button type="button" className={`${textLink} mt-3`} onClick={() => setPasting(true)}>Or paste the text</button>
              )}
              {pasting && (
                <div className="mt-4">
                  <label htmlFor="redline-paste" className="mb-1 block text-sm text-muted">Correction letter text</label>
                  <textarea id="redline-paste" rows={8} className={field} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                  <button
                    type="button"
                    className={`${quiet} mt-2`}
                    onClick={async () => {
                      setError(null);
                      try {
                        accept(await api("start/extract", { text: pasted }));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Read this letter
                  </button>
                </div>
              )}
              <p className="mt-4 text-[13px] leading-relaxed text-muted">Your letter goes to an AI model to prepare the preview. Redline drafts responses; a licensed professional reviews them before anything is filed. Not legal advice.</p>
            </>
          )}
          {errorLine}
        </>
      )}

      {stage === "check" && (
        <>
          <h1 className="mt-4 font-display text-4xl tracking-tight">Check what we read</h1>
          <p className="mt-3 text-[15px] text-ink/80">We found {comments.length} comment{comments.length === 1 ? "" : "s"}. Fix anything we misread, then see your preview.</p>
          {warnings.map((w) => <p key={w} className="mt-2 text-sm text-safety">{w}</p>)}
          <label htmlFor="redline-place" className="mt-5 mb-1 block text-sm text-muted">City</label>
          <select id="redline-place" className={field} value={place} onChange={(e) => setPlace(e.target.value)}>
            {offer?.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="other">Another city</option>
          </select>
          {place === "chicago" && (
            <label className="mt-3 flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" className="mt-1" checked={edition2026} onChange={(e) => setEdition2026(e.target.checked)} />
              This application started on or after December 1, 2026, or chose Chicago&apos;s 2026 code.
            </label>
          )}
          <label htmlFor="redline-permit" className="mt-4 mb-1 block text-sm text-muted">Permit number (optional, so later rounds are free)</label>
          <input id="redline-permit" className={field} value={permit} onChange={(e) => setPermit(e.target.value)} />
          <div className="mt-4 space-y-2">
            {comments.map((c, i) => (
              <div key={c.id} className="rounded-lg border border-rule p-3">
                <label htmlFor={`redline-c-${c.id}`} className="mb-1 block text-sm text-muted">Comment {i + 1}{c.heading && c.heading !== "Pasted" ? `: ${c.heading}` : ""}</label>
                <textarea
                  id={`redline-c-${c.id}`}
                  rows={Math.min(6, 2 + Math.floor(c.text.length / 90))}
                  className={field}
                  value={c.text}
                  onChange={(e) => setComments(comments.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                />
                <button type="button" className={textLink} onClick={() => setComments(comments.filter((x) => x.id !== c.id))}>Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className={primary} disabled={!comments.length} onClick={run}>See my free preview</button>
            <button type="button" className={textLink} onClick={restart}>Start over</button>
          </div>
          {errorLine}
        </>
      )}

      {stage === "working" && (
        <div aria-live="polite">
          <h1 className="mt-4 font-display text-4xl tracking-tight">{reportId ? "Opening your report" : "Reading your letter"}</h1>
          <p className="mt-3 text-[15px] text-ink/80">{reportId ? "One moment." : "Sorting each comment and looking up the code. This usually takes under a minute."}</p>
        </div>
      )}

      {stage === "stop" && (
        <>
          <h1 className="mt-4 font-display text-4xl tracking-tight">We can&apos;t do this one yet</h1>
          <p className="mt-3 text-[15px] text-ink/80">{stopMessage}</p>
          <label htmlFor="redline-email" className="mt-5 mb-1 block text-sm text-muted">Email me when it&apos;s covered</label>
          <input id="redline-email" type="email" autoComplete="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={quiet} onClick={joinWaitlist}>Notify me</button>
            <button type="button" className={textLink} onClick={restart}>Try another letter</button>
            {waitDone && <span aria-live="polite" className="text-sm font-semibold text-teal">Thanks, we&apos;ll email you.</span>}
          </div>
          {errorLine}
        </>
      )}

      {stage === "report" && report && (
        <>
          <h1 className="mt-4 font-display text-4xl tracking-tight">{report.unlocked ? "Your response package" : `Here's your letter: ${report.items.length} comment${report.items.length === 1 ? "" : "s"}, sorted`}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{report.place}{report.permit_number ? `, permit ${report.permit_number}` : ""}. Drafts are for a licensed professional to review; nothing here is a finding that plans meet code.</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.keys(ROUTES).filter((k) => report.counts[k]).map((k) => (
              <div key={k} className="rounded-lg border border-rule p-3">
                <b className="block font-display text-2xl tabular-nums">{report.counts[k]}</b>
                <span className="text-[13px] text-muted">{ROUTES[k][0]}</span>
              </div>
            ))}
          </div>
          {report.unlocked && (
            <div className="mt-4 rounded-lg border border-rule p-4">
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/api/redline/report/${report.id}/export`} className={quiet}>Download Word draft</a>
                <button type="button" className={quiet} onClick={share}>Copy link for your architect</button>
                <button type="button" className={quiet} onClick={startNextRound}>Add the next letter on this permit, free</button>
                {copied && <span aria-live="polite" className="text-sm font-semibold break-all text-teal">{copied}</span>}
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm text-muted">
                <input type="checkbox" className="mt-1" checked={report.learning_opt_in} onChange={(e) => setOptIn(e.target.checked)} />
                Let Redline learn from reject notes on this permit. Off by default.
              </label>
            </div>
          )}
          {Object.keys(ROUTES).map((k) => {
            const items = report.items.filter((i) => i.route === k);
            if (!items.length) return null;
            return (
              <div key={k}>
                <h2 className="mt-6 mb-2 text-sm font-semibold">{ROUTES[k][0]} {ROUTES[k][1] && <span className="ml-1 font-normal text-muted">{ROUTES[k][1]}</span>}</h2>
                {items.map((item) => <ItemCard key={item.comment} item={item} unlocked={report.unlocked} onDecide={(d, n) => decide(item, d, n)} />)}
              </div>
            );
          })}
          {!report.unlocked && offer && (
            <div className="mt-5 rounded-lg border border-ink p-4">
              <p className="text-sm text-ink/80">{lockedCount ? `${lockedCount} more draft${lockedCount === 1 ? "" : "s"} and citations are ready.` : "Unlock the Word draft and the reviewer link."}</p>
              {!offer.payments && (
                <label className="mt-3 flex items-start gap-2 text-sm text-ink/80">
                  <input type="checkbox" className="mt-1" checked={partner} onChange={(e) => setPartner(e.target.checked)} />
                  I&apos;ll share reviewer notes on this letter, and Redline may learn from them.
                </label>
              )}
              <button type="button" className={`${primary} mt-3`} onClick={unlock}>{offer.payments ? `Unlock this permit, ${offer.price}` : "Unlock free as a design partner"}</button>
              <p className="mt-2 text-[13px] text-muted">{offer.payments ? "Includes every correction letter on this permit for 12 months and a 14-day refund." : "Redline is free for early partners, in exchange for feedback from a real review."}</p>
            </div>
          )}
          {errorLine}
        </>
      )}
    </section>
  );
}
