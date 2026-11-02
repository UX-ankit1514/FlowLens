"use client";

import { useId } from "react";

/**
 * The FlowLens mark: a journey (the S-shaped path) passes behind a lens, and
 * the lens brings one point into focus (the amber dot: the friction found).
 * Drawn on a 32-unit grid; the path stops a fixed distance from the lens so
 * it reads as passing behind the glass.
 */
export const MARK = {
  tile: "M11 0H21C29.8 0 32 2.2 32 11V21C32 29.8 29.8 32 21 32H11C2.2 32 0 29.8 0 21V11C0 2.2 2.2 0 11 0Z",
  pathIn: "M3.9 25.7C5.69 26.1 7.54 25.17 9.42 23.53",
  pathOut: "M28.1 6.3C26.31 5.9 24.46 6.83 22.58 8.47",
  lensRadius: 6,
  focusRadius: 2.4,
  stroke: 2.6,
  colors: { brandTop: "#2F57D8", brandBottom: "#1C3A9E", brand: "#2142B5", focus: "#FFB547", white: "#FFFFFF" },
} as const;

export type MarkTone = "brand" | "inverse";

/**
 * - brand: blue tile, white lens (on light surfaces).
 * - inverse: white tile, blue lens (on the brand-blue hero).
 */
export function LogoMark({ size = 28, tone = "brand", title }: { size?: number; tone?: MarkTone; title?: string }) {
  const gradientId = `flowlens-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ink = tone === "brand" ? MARK.colors.white : MARK.colors.brand;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      {tone === "brand" ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor={MARK.colors.brandTop} />
              <stop offset="1" stopColor={MARK.colors.brandBottom} />
            </linearGradient>
          </defs>
          <path d={MARK.tile} fill={`url(#${gradientId})`} />
        </>
      ) : (
        <path d={MARK.tile} fill={MARK.colors.white} />
      )}
      <circle cx="16" cy="16" r={MARK.lensRadius} stroke={ink} strokeWidth={MARK.stroke} />
      <path d={MARK.pathIn} stroke={ink} strokeWidth={MARK.stroke} strokeLinecap="round" />
      <path d={MARK.pathOut} stroke={ink} strokeWidth={MARK.stroke} strokeLinecap="round" />
      <circle cx="16" cy="16" r={MARK.focusRadius} fill={MARK.colors.focus} />
    </svg>
  );
}
