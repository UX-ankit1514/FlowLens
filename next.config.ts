import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is the project root (there's an unrelated lockfile in the home directory).
  turbopack: { root: path.resolve(__dirname) },
  // Blade is built on styled-components; this enables SSR-safe class names.
  compiler: { styledComponents: true },
  // Server-only SDKs: keep them as native Node modules instead of bundling.
  serverExternalPackages: ["@tiny-fish/sdk", "@anthropic-ai/sdk"],
  poweredByHeader: false,
  // The setup form moved from "/" to "/new" when "/" became the landing page.
  // Older "run again" links (/?from=<id>) keep working; the query is passed through.
  async redirects() {
    return [{ source: "/", has: [{ type: "query", key: "from" }], destination: "/new", permanent: false }];
  },
};

export default nextConfig;
