"use client";

import { useState } from "react";
import type { CityPlace } from "@/components/places";

interface Props {
  places: CityPlace[] | null;
  placeId: string | null;
  placesError: string | null;
  signedIn: boolean;
  authReady: boolean;
  email: string | null;
  onPlaceChange: (id: string) => void;
  onSearch: (query: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function MapCard({
  places,
  placeId,
  placesError,
  signedIn,
  authReady,
  email,
  onPlaceChange,
  onSearch,
  onSignIn,
  onSignOut,
}: Props) {
  const [query, setQuery] = useState("");
  const loading = places === null && !placesError;

  return (
    <div className="absolute left-4 top-4 z-10 w-[360px] rounded-lg border border-rule bg-paper p-4 shadow-md">
      <div className="font-display text-[28px] leading-none tracking-tight text-ink">Emris</div>
      <label className="mt-3 block font-sans text-xs text-muted" htmlFor="emris-place">
        Place
      </label>
      <select
        id="emris-place"
        value={placeId ?? ""}
        disabled={!places || places.length === 0}
        onChange={(event) => onPlaceChange(event.target.value)}
        className="mt-1 w-full appearance-none border-b border-rule bg-transparent pb-1.5 font-sans text-sm text-ink outline-none focus:border-ink disabled:text-muted"
      >
        {loading ? <option value="">Loading places…</option> : null}
        {placesError ? <option value="">Places unavailable</option> : null}
        {places?.map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </select>
      {placesError ? <p className="mt-2 font-sans text-sm text-ink">{placesError}</p> : null}
      {authReady && signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(query);
          }}
        >
          <label className="sr-only" htmlFor="emris-search">
            Search an address or neighborhood
          </label>
          <input
            id="emris-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search an address or neighborhood"
            className="mt-3 w-full border-b border-rule bg-transparent pb-1.5 font-sans text-sm text-ink outline-none placeholder:text-muted focus:border-ink"
          />
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
