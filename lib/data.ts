// Shared types and server-side loaders. Types must match contract.md exactly.
// Client code may `import type { ... } from "@/lib/data"`; the loaders use node:fs and are server-only.
import { promises as fs } from "node:fs";
import path from "node:path";

// ---------- contract §1.1 tracts ----------

export type Momentum = "up" | "flat" | "down";

export interface Signals {
  mf_permits: number; // int 0-100
  permit_momentum: number; // int 0-100
  infra_proximity: number; // int 0-100
}

export interface TractProps {
  geoid: string; // 11 digits
  name: string; // "<Community Area> · Tract <number>"
  score: number; // int 0-100
  percentile: number; // int 0-100
  momentum: Momentum;
  momentum_pct: number; // 1 decimal
  signals: Signals;
  permit_count_24mo: number;
  units_24mo: number;
}

export type Position = [lng: number, lat: number];

export type TractGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export interface TractFeature {
  type: "Feature";
  properties: TractProps;
  geometry: TractGeometry;
}

export interface TractCollection {
  type: "FeatureCollection";
  as_of: string; // "YYYY-MM-DD"
  features: TractFeature[];
}

// ---------- contract §1.2 permits ----------

export interface Permit {
  id: string;
  address: string;
  lat: number;
  lng: number;
  issue_date: string; // "YYYY-MM-DD"
  units: number | null;
  description: string;
  geoid: string;
}

// ---------- contract §1.3 infrastructure ----------

export type ProjectType = "transit" | "park" | "streetscape" | "civic" | "other";
export type ProjectStatus = "planned" | "funded" | "under_construction" | "complete";

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  lat: number;
  lng: number;
  budget_usd: number | null;
  expected_completion: string | null;
  description: string;
  source_url: string | null;
  source?: "firecrawl" | "curated"; // optional (contract §1.3)
  retrieved_at?: string; // optional ISO date
}

export type ProjectWithDistance = Project & { distance_mi: number };

// ---------- contract §2 API shapes ----------

export interface ApiError {
  error: string;
}

/** GET /api/tracts */
export type TractsResponse = TractCollection;

/** GET /api/tract/[geoid] */
export interface TractDetailResponse {
  tract: TractProps;
  top_permits: Permit[]; // max 10, newest first
  nearby_projects: ProjectWithDistance[]; // within 1 mi of centroid, nearest first
}

/** GET /api/near?q=&radius_mi= */
export interface NearResponse {
  place: { label: string; lat: number; lng: number };
  tract: TractProps | null;
  permits: Permit[]; // within radius, newest first, max 25
  projects: ProjectWithDistance[]; // within radius, nearest first
}

/** POST /api/memo */
export interface MemoRequest {
  geoid: string;
}
export interface MemoResponse {
  geoid: string;
  title: string;
  memo_markdown: string;
}

/** POST /api/ask */
export interface AskRequest {
  question: string;
}
export interface AskResponse {
  reply: string; // plain text, < 600 chars, no markdown
  url: string; // "/?tract=<geoid>" or "/?lat=..&lng=..&z=.."
}

// ---------- loaders ----------

const DATA_DIR = path.join(process.cwd(), "data");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")) as T;
}

// Cached per server process. Restart the dev server after replacing files in /data.
let tractsP: Promise<TractCollection> | undefined;
let permitsP: Promise<Permit[]> | undefined;
let projectsP: Promise<Project[]> | undefined;

export function getTracts(): Promise<TractCollection> {
  return (tractsP ??= readJson<TractCollection>("tracts.geojson"));
}

/** Sorted by issue_date, newest first. */
export function getPermits(): Promise<Permit[]> {
  return (permitsP ??= readJson<Permit[]>("permits.json"));
}

export function getProjects(): Promise<Project[]> {
  return (projectsP ??= readJson<Project[]>("infrastructure.json"));
}
