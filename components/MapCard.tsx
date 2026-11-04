"use client";

import { useState } from "react";
import { searchLimitMessage, type CityPlace } from "@/components/places";

interface Props {
  places: CityPlace[] | null;
  placeId: string | null;
  selectedName: string | null;
  placesError: string | null;
  placesEmpty: boolean;
  signedIn: boolean;
  authReady: boolean;
  email: string | null;
  searchLocked: boolean;
  searchResets: string | null;
  onPlaceChange: (id: string) => void;
  onRetryPlaces: () => void;
  onSearch: (query: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function MapCard({
  places,
  placeId,
  selectedName,
  placesError,
  placesEmpty,
  signedIn,
  authReady,
  email,
  searchLocked,
  searchResets,
  onPlaceChange,
  onRetryPlaces,
  onSearch,
  onSignIn,
  onSignOut,
}: Props) {
  const [query, setQuery] = useState("");
  const loading = places === null && !placesError && !placesEmpty;
  const restored = Boolean(placeId && selectedName && !places?.length && !placesEmpty);

  return (
    <div className="absolute left-4 top-4 z-10 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-rule bg-paper p-4 shadow-md">
      <div className="font-display text-[28px] leading-none tracking-tight text-ink">Emris</div>
      <label className="mt-3 block font-sans text-xs text-muted" htmlFor="emris-place">
        Place
      </label>
      <select
        id="emris-place"
        value={placeId ?? ""}
        disabled={!restored && (!places || places.length === 0)}
        onChange={(event) => onPlaceChange(event.target.value)}
        className="mt-1 w-full appearance-none border-b border-rule bg-transparent pb-1.5 font-sans text-sm text-ink outline-none focus:border-ink focus-visible:border-ink disabled:text-muted"
      >
        {loading && !restored ? <option value="">Loading places…</option> : null}
        {restored ? <option value={placeId ?? ""}>{selectedName}</option> : null}
        {placesError && !restored ? <option value="">Places unavailable</option> : null}
        {placesEmpty ? <option value="">No markets are live yet</option> : null}
        {places?.map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </select>
      {placesEmpty ? (
        <p className="mt-2 font-sans text-sm text-ink">No markets are live yet.</p>
      ) : null}
      {placesError ? (
        <div className="mt-2">
          <p className="font-sans text-sm text-ink">{placesError}</p>
          <button
            type="button"
            onClick={onRetryPlaces}
            className="mt-2 font-sans text-sm text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Try again
          </button>
        </div>
      ) : null}
      {authReady && signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (searchLocked) return;
            onSearch(query);
          }}
        >
          <label className="sr-only" htmlFor="emris-search">
            Search an address or neighborhood
          </label>
          <input
            id="emris-search"
            value={query}
            disabled={searchLocked}
            aria-describedby={searchLocked ? "emris-search-limit" : undefined}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLocked ? "Search is paused" : "Search an address or neighborhood"}
            className="mt-3 w-full border-b border-rule bg-transparent pb-1.5 font-sans text-sm text-ink outline-none placeholder:text-muted focus:border-ink disabled:text-muted"
          />
          {searchLocked ? (
            <p id="emris-search-limit" className="mt-2 font-sans text-sm text-ink">
              {searchLimitMessage(searchResets)}
            </p>
          ) : null}
        </form>
      ) : null}
      {authReady && !signedIn ? (
        <button
          type="button"
          onClick={onSignIn}
          className="mt-3 font-sans text-sm text-ink underline underline-offset-2"
        >
          Sign in
        </button>
      ) : null}
      {signedIn && email ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-sans text-xs text-muted">{email}</p>
          <button
            type="button"
            onClick={onSignOut}
            className="shrink-0 font-sans text-xs text-ink underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
