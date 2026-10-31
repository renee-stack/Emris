"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapCard from "@/components/MapCard";
import MemoModal from "@/components/MemoModal";
import SidePanel, { type SearchState } from "@/components/SidePanel";
import { ApiError, fetchNear, fetchPlaces, fetchTracts } from "@/components/load";
import type { CityPlace } from "@/components/places";
import { signOut, useAuth } from "@/components/use-auth";
import type { ProjectWithDistance, TractCollection, TractProps } from "@/lib/data";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

interface MemoTarget {
  geoid: string;
  name: string;
  score: number;
}

const PLACE_KEY = "emris-place";

export default function Page() {
  const { email, ready } = useAuth();
  const signedIn = Boolean(email);
  const [mode, setMode] = useState<"tract" | "search" | "account" | null>(null);
  const [geoid, setGeoid] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [projects, setProjects] = useState<ProjectWithDistance[]>([]);
  const [fit, setFit] = useState<{ geoid: string; token: number } | null>(null);
  const [memo, setMemo] = useState<MemoTarget | null>(null);
  const [places, setPlaces] = useState<CityPlace[] | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [tracts, setTracts] = useState<TractCollection | null>(null);
  const [tractCoverage, setTractCoverage] = useState<unknown>(null);
  const [tractsError, setTractsError] = useState<string | null>(null);
  const requestId = useRef(0);

  const onProjects = useCallback((next: ProjectWithDistance[]) => {
    setProjects(next);
  }, []);

  const closeMemo = useCallback(() => setMemo(null), []);

  useEffect(() => {
    let cancelled = false;
    void fetchPlaces()
      .then((list) => {
        if (cancelled) return;
        setPlaces(list);
        let saved: string | null = null;
        try {
          saved = sessionStorage.getItem(PLACE_KEY);
        } catch {
          saved = null;
        }
        const next = list.find((place) => place.id === saved) ?? list[0];
        setPlaceId(next?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setPlacesError("Couldn't load places.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!placeId) return;
    try {
      sessionStorage.setItem(PLACE_KEY, placeId);
    } catch {
      // Ignore private-mode storage failures.
    }
    let cancelled = false;
    setTracts(null);
    setTractCoverage(null);
    setTractsError(null);
    void fetchTracts(placeId)
      .then(({ collection, coverage }) => {
        if (cancelled) return;
        setTracts(collection);
        setTractCoverage(coverage);
      })
      .catch(() => {
        if (!cancelled) setTractsError("Couldn't load tract scores.");
      });
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  useEffect(() => {
    if (!ready || email) return;
    setProjects([]);
    setMemo(null);
    setSearch(null);
    setMode((current) => (current === "search" ? "account" : current));
  }, [email, ready]);

  useEffect(() => {
    if (!email || mode !== "account") return;
    setMode(null);
  }, [email, mode]);

  const place = useMemo(
    () => places?.find((item) => item.id === placeId) ?? null,
    [places, placeId],
  );

  const summary = useMemo<TractProps | null>(() => {
    if (!geoid || !tracts) return null;
    return tracts.features.find((feature) => feature.properties.geoid === geoid)?.properties ?? null;
  }, [geoid, tracts]);

  const coverageSources = useMemo(
    () => [tractCoverage, place?.coverage],
    [tractCoverage, place],
  );

  const onPlaceChange = useCallback((id: string) => {
    if (!id || id === placeId) return;
    requestId.current += 1;
    setPlaceId(id);
    setMode(null);
    setGeoid(null);
    setSearch(null);
    setProjects([]);
    setMemo(null);
    setFit(null);
  }, [placeId]);

  const openTract = useCallback((id: string, fitCamera: boolean) => {
    requestId.current += 1;
    setMode("tract");
    setGeoid(id);
    setSearch(null);
    if (!email) setProjects([]);
    if (fitCamera) setFit({ geoid: id, token: Date.now() });
  }, [email]);

  const onSearch = useCallback((raw: string) => {
    if (!email) return;
    const query = raw.trim();
    if (!query) return;
    const id = ++requestId.current;
    setMode("search");
    setGeoid(null);
    setProjects([]);
    setSearch({ status: "loading", place: null, result: null, error: null, resets: null });
    void fetchNear(query)
      .then((result) => {
        if (id !== requestId.current) return;
        const pin = { lat: result.place.lat, lng: result.place.lng, zoom: 15 };
        setSearch({ status: "ready", place: pin, result, error: null, resets: null });
        setProjects(result.projects);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        if (err instanceof ApiError && err.status === 429) {
          setSearch({
            status: "limited",
            place: null,
            result: null,
            error: null,
            resets: err.resets,
          });
          return;
        }
        setSearch({
          status: "error",
          place: null,
          result: null,
          error:
            err instanceof ApiError && err.status === 404
              ? "Couldn't find that address or neighborhood."
              : "The search didn't go through. Try again.",
          resets: null,
        });
      });
  }, [email]);

  const onClose = useCallback(() => {
    requestId.current += 1;
    setMode(null);
    setGeoid(null);
    setSearch(null);
    setProjects([]);
    setMemo(null);
  }, []);

  const searchPin = mode === "search" ? (search?.place ?? null) : null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-paper">
      <MapView
        panelOpen={mode !== null}
        projects={signedIn ? projects : []}
        searchPin={signedIn ? searchPin : null}
        fit={fit}
        bounds={place?.bounds ?? null}
        placeId={place?.id ?? null}
        placeName={place?.name ?? null}
        tracts={tracts}
        loadError={tractsError}
        onTractClick={(id) => openTract(id, false)}
      />
      <MapCard
        places={places}
        placeId={placeId}
        placesError={placesError}
        signedIn={signedIn}
        authReady={ready}
        email={email}
        onPlaceChange={onPlaceChange}
        onSearch={onSearch}
        onSignIn={() => setMode("account")}
        onSignOut={() => {
          void signOut();
        }}
      />
      <SidePanel
        open={mode !== null}
        mode={mode}
        geoid={geoid}
        summary={summary}
        placeName={place?.name ?? null}
        coverageSources={coverageSources}
        signedIn={signedIn}
        authReady={ready}
        search={search}
        onClose={onClose}
        onOpenTract={(id) => openTract(id, true)}
        onProjects={onProjects}
        onGenerateMemo={setMemo}
      />
      {memo && signedIn ? (
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
