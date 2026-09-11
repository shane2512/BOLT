import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env at the repo root serves the whole workspace — the scripts, the tests
// and the app read the same Privy, Arc and Postgres credentials. Next would
// otherwise only look inside apps/web.
config({ path: "../../.env" });

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source rather than a build step,
  // so Next has to compile them alongside the app.
  transpilePackages: ["@bolt/core", "@bolt/db", "@bolt/privy"],
  // Those packages write NodeNext-style relative imports (`./bps.js` for
  // `bps.ts`). Turbopack does not rewrite that extension, so the app builds
  // with webpack, which does. Revisit when Turbopack grows `extensionAlias`.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return cfg;
  }
};

export default nextConfig;
