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
};

export default nextConfig;
