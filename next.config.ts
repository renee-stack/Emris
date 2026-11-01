import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["stripe"],
  cacheComponents: true,
  partialPrefetching: true,
  // API routes read data/ with fs at runtime; make sure Vercel bundles it with each function.
  outputFileTracingIncludes: {
    "/api/**": ["./data/*.json", "./data/*.geojson"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
