"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import MemoModal from "@/components/MemoModal";
import SidePanel from "@/components/SidePanel";
import { ApiError, fetchNear } from "@/components/load";
import type { NearResponse, ProjectWithDistance } from "@/lib/data";
import { pointHref, readDeepLink, tractHref } from "@/lib/spatial";
import type { MapPlace } from "@/components/MapView";

function mapHref(href: string): string {
  return href.startsWith("/?") ? `/map${href.slice(1)}` : "/map";
}

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-paper" />,
});

interface SearchState {
  status: "loading" | "ready" | "error";
  place: MapPlace | null;
  result: NearResponse | null;
  error: string | null;
}

interface MemoTarget {
  geoid: string;
  name: string;
  score: number;
}

export default function Page() {
  const [mode, setMode] = useState<"tract" | "search" | null>(null);
  const [geoid, setGeoid] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [projects, setProjects] = useState<ProjectWithDistance[]>([]);
  const [fit, setFit] = useState<{ geoid: string; token: number } | null>(null);
  const [memo, setMemo] = useState<MemoTarget | null>(null);
  const requestId = useRef(0);

  const onProjects = useCallback((next: ProjectWithDistance[]) => {
    setProjects(next);
  }, []);

  const closeMemo = useCallback(() => setMemo(null), []);

  useEffect(() => {
    const link = readDeepLink(window.location.search);
    if (!link) return;
    const id = ++requestId.current;
    // The URL is only available on the client. Apply it after paint so the
    // server shell and the first client render stay the same.
    const timer = window.setTimeout(() => {
      if (link.kind === "tract") {
        setMode("tract");
        setGeoid(link.geoid);
        return;
      }
      const place = { lat: link.lat, lng: link.lng, zoom: link.zoom };
      setMode("search");
      setSearch({ status: "loading", place, result: null, error: null });
      void fetchNear(`${link.lat},${link.lng}`)
        .then((result) => {
          if (id !== requestId.current) return;
          setSearch({ status: "ready", place, result, error: null });
          setProjects(result.projects);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setSearch({
            status: "error",
            place,
            result: null,
            error:
              err instanceof ApiError && err.status === 404
                ? "Couldn't find that address or neighborhood."
                : "The search didn't go through. Try again.",
          });
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openTract = useCallback((id: string, fitCamera: boolean) => {
    requestId.current += 1;
    window.history.replaceState(null, "", mapHref(tractHref(id)));
    setMode("tract");
    setGeoid(id);
    setSearch(null);
    setProjects([]);
    if (fitCamera) setFit({ geoid: id, token: Date.now() });
  }, []);

  const onSearch = useCallback((raw: string) => {
    const query = raw.trim();
    if (!query) return;
    const id = ++requestId.current;
    setMode("search");
    setGeoid(null);
    setProjects([]);
    setSearch({ status: "loading", place: null, result: null, error: null });
    void fetchNear(query)
      .then((result) => {
        if (id !== requestId.current) return;
        const place = { lat: result.place.lat, lng: result.place.lng, zoom: 15 };
        window.history.replaceState(null, "", mapHref(pointHref(place.lat, place.lng, place.zoom)));
        setSearch({ status: "ready", place, result, error: null });
        setProjects(result.projects);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setSearch({
          status: "error",
          place: null,
          result: null,
          error:
            err instanceof ApiError && err.status === 404
              ? "Couldn't find that address or neighborhood."
              : "The search didn't go through. Try again.",
        });
      });
  }, []);

  const onClose = useCallback(() => {
    requestId.current += 1;
    window.history.replaceState(null, "", "/map");
    setMode(null);
    setGeoid(null);
    setSearch(null);
    setProjects([]);
    setMemo(null);
  }, []);

  const place = mode === "search" ? (search?.place ?? null) : null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-paper">
      <MapView
        panelOpen={mode !== null}
        projects={projects}
        place={place}
        fit={fit}
        onTractClick={(id) => openTract(id, false)}
        onSearch={onSearch}
      />
      <SidePanel
        open={mode !== null}
        mode={mode}
        geoid={geoid}
        search={search}
        onClose={onClose}
        onOpenTract={(id) => openTract(id, true)}
        onProjects={onProjects}
        onGenerateMemo={setMemo}
      />
      {memo ? (
        <MemoModal
          geoid={memo.geoid}
          name={memo.name}
          score={memo.score}
          onClose={closeMemo}
        />
      ) : null}
    </main>
  );
}
