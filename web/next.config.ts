import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads live agent data, so nothing is cached.
  cacheComponents: false,
  // Loaded from node_modules at runtime (it ships a WASM build of Postgres).
  serverExternalPackages: ["@electric-sql/pglite"],
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
