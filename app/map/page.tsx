"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapCard from "@/components/MapCard";
import MemoModal from "@/components/MemoModal";
import SidePanel, { type SearchState } from "@/components/SidePanel";
import { ApiError, fetchNear, fetchPlaces, fetchTracts } from "@/components/load";
import { resetMillis, type CityPlace } from "@/components/places";
import MapTour, { tourRequested } from "@/components/MapTour";
import { signOut, useAuth } from "@/components/use-auth";
import { markCheck } from "@/lib/checklist";
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
const TRACT_KEY = "emris-tract";
const LOCK_KEY = "emris-search-lock";
const PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const TRACT_RE = /^\d{11}$/;

interface SavedPlace {
  id: string;
  name: string;
}

function readSavedPlace(): SavedPlace | null {
  try {
    const raw = sessionStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
      if (typeof parsed.id === "string" && PLACE_RE.test(parsed.id)) {
        return { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : "" };
      }
      return null;
    }
    return PLACE_RE.test(raw) ? { id: raw, name: "" } : null;
  } catch {
    return null;
  }
}

function writeSavedPlace(place: SavedPlace) {
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // Ignore private-mode storage failures.
  }
}

function readReturnQuery(): { place: string | null; tract: string | null } {
  const params = new URLSearchParams(window.location.search);
  const place = params.get("place");
  const tract = params.get("tract");
  return {
    place: place && PLACE_RE.test(place) ? place : null,
    tract: tract && TRACT_RE.test(tract) ? tract : null,
  };
}

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
  const [placesEmpty, setPlacesEmpty] = useState(false);
  const [placesAttempt, setPlacesAttempt] = useState(0);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [rememberedName, setRememberedName] = useState<string | null>(null);
  const [pendingTract, setPendingTract] = useState<string | null>(null);
  const [searchLock, setSearchLock] = useState<string | null>(null);
  const [tracts, setTracts] = useState<TractCollection | null>(null);
  const [tractCoverage, setTractCoverage] = useState<unknown>(null);
  const [tractsError, setTractsError] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(false);
  const requestId = useRef(0);
  const placeIdRef = useRef(placeId);
  placeIdRef.current = placeId;

  const onProjects = useCallback((next: ProjectWithDistance[]) => {
    setProjects(next);
  }, []);

  const closeMemo = useCallback(() => setMemo(null), []);

  useEffect(() => {
    setShowTour(tourRequested());
  }, []);

  useEffect(() => {
    if (signedIn && geoid) markCheck("tract");
  }, [signedIn, geoid]);

  useEffect(() => {
    if (signedIn && search?.status === "ready") markCheck("search");
  }, [signedIn, search]);

  useEffect(() => {
    if (signedIn && memo) markCheck("memo");
  }, [signedIn, memo]);

  useEffect(() => {
    const saved = readSavedPlace();
    const fromUrl = readReturnQuery();
    if (saved?.name) setRememberedName(saved.name);
    const initialId = fromUrl.place ?? saved?.id ?? null;
    if (initialId) setPlaceId((current) => current ?? initialId);
    if (fromUrl.tract) setPendingTract(fromUrl.tract);
    try {
      const raw = sessionStorage.getItem(LOCK_KEY);
      if (!raw) return;
      const at = raw === "unknown" ? null : resetMillis(raw);
      if (raw === "unknown" || at == null || at > Date.now()) setSearchLock(raw);
      else sessionStorage.removeItem(LOCK_KEY);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, []);

  useEffect(() => {
    if (!searchLock || searchLock === "unknown") return;
    const at = resetMillis(searchLock);
    if (at == null) return;
    const delay = at - Date.now();
    if (delay <= 0) {
      setSearchLock(null);
      try {
        sessionStorage.removeItem(LOCK_KEY);
      } catch {
        // Ignore private-mode storage failures.
      }
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchLock(null);
      try {
        sessionStorage.removeItem(LOCK_KEY);
      } catch {
        // Ignore private-mode storage failures.
      }
    }, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [searchLock]);

  useEffect(() => {
    let cancelled = false;
    setPlacesError(null);
    setPlacesEmpty(false);
    void fetchPlaces()
      .then((list) => {
        if (cancelled) return;
        setPlaces(list);
        if (list.length === 0) {
          setPlacesEmpty(true);
          setPlaceId(null);
          setRememberedName(null);
          return;
        }
        const saved = readSavedPlace();
        const fromUrl = readReturnQuery();
        const next =
          list.find((place) => place.id === fromUrl.place) ??
          list.find((place) => place.id === saved?.id) ??
          list.find((place) => place.id === placeIdRef.current) ??
          list[0];
        if (!next) return;
        setPlaceId(next.id);
        setRememberedName(next.name);
        writeSavedPlace({ id: next.id, name: next.name });
      })
      .catch(() => {
        if (!cancelled) {
          setPlaces(null);
          setPlacesError("Couldn't load places.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [placesAttempt]);

  useEffect(() => {
    if (!placeId) {
      setTracts(null);
      setTractCoverage(null);
      return;
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

  const searchLocked =
    searchLock !== null &&
    (searchLock === "unknown" || (resetMillis(searchLock) ?? 0) > Date.now());

  useEffect(() => {
    if (!place) return;
    setRememberedName(place.name);
    writeSavedPlace({ id: place.id, name: place.name });
  }, [place]);

  useEffect(() => {
    try {
      if (geoid && TRACT_RE.test(geoid)) sessionStorage.setItem(TRACT_KEY, geoid);
      else sessionStorage.removeItem(TRACT_KEY);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [geoid]);

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

  useEffect(() => {
    if (!pendingTract || !tracts) return;
    const tractId = pendingTract;
    const exists = tracts.features.some((feature) => feature.properties.geoid === tractId);
    if (exists) openTract(tractId, false);
    setPendingTract(null);
  }, [pendingTract, tracts, openTract]);

  const onSearch = useCallback((raw: string) => {
    if (!email || searchLocked) return;
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
          const token = err.resets && resetMillis(err.resets) != null ? err.resets : "unknown";
          const until = token === "unknown" ? null : resetMillis(token);
          if (until == null || until > Date.now()) {
            setSearchLock(token);
            try {
              sessionStorage.setItem(LOCK_KEY, token);
            } catch {
              // Ignore private-mode storage failures.
            }
          }
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
  }, [email, searchLocked]);

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
        placeName={place?.name ?? rememberedName}
        tracts={tracts}
        loadError={tractsError}
        onTractClick={(id) => openTract(id, false)}
      />
      <MapCard
        places={places}
        placeId={placeId}
        selectedName={place?.name ?? rememberedName}
        placesError={placesError}
        placesEmpty={placesEmpty}
        signedIn={signedIn}
        authReady={ready}
        email={email}
        searchLocked={searchLocked}
        searchResets={searchLock && searchLock !== "unknown" ? searchLock : null}
        onPlaceChange={onPlaceChange}
        onRetryPlaces={() => setPlacesAttempt((value) => value + 1)}
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
        placeId={place?.id ?? placeId}
        placeName={place?.name ?? rememberedName}
        coverageSources={coverageSources}
        signedIn={signedIn}
        authReady={ready}
        search={search}
        onClose={onClose}
        onOpenTract={(id) => openTract(id, true)}
        onProjects={onProjects}
        onGenerateMemo={setMemo}
      />
      {showTour ? <MapTour /> : null}
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
