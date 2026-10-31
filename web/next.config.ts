import path from "node:path";
import type { NextConfig } from "next";

// The repo root holds web/, legacy/ and pipeline/. Trace and bundle from there so the
// API routes can read the hackathon data in ../legacy/data until v2 moves to Postgres.
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: repoRoot,
  // API routes read legacy data with fs at runtime; make sure Vercel bundles it with each function.
  outputFileTracingIncludes: {
    "/api/**": ["../legacy/data/*.json", "../legacy/data/*.geojson"],
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
