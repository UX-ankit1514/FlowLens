"use client";

import styled from "styled-components";
import type { Theme } from "@razorpay/blade/components";

/** 16:10 frame for step screenshots (matches the agent's desktop viewport). */
export const Thumb = styled.a(
  ({ theme }: { theme: Theme }) => `
  display: block;
  position: relative;
  aspect-ratio: 16 / 10;
  border: 1px solid ${theme.colors.surface.border.gray.muted};
  border-radius: ${theme.border.radius.small}px;
  overflow: hidden;
  background: ${theme.colors.surface.background.gray.moderate};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
    display: block;
  }
  .thumb-message {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: ${theme.spacing[4]}px;
    text-align: center;
  }
  &:focus-visible {
    outline: 2px solid ${theme.colors.interactive.background.primary.default};
    outline-offset: 2px;
  }
`,
);

export function screenshotUrl(sessionId: string, stepId: string) {
  return `/api/sessions/${sessionId}/evidence/${encodeURIComponent(stepId)}`;
}
