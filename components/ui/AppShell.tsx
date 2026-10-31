"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import styled from "styled-components";
import { Box, Text } from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";

const Bar = styled.header(
  ({ theme }: { theme: Theme }) => `
  position: sticky;
  top: 0;
  z-index: 10;
  background: ${theme.colors.surface.background.gray.intense};
  border-bottom: 1px solid ${theme.colors.surface.border.gray.muted};
`,
);

const BrandLink = styled(NextLink)(
  ({ theme }: { theme: Theme }) => `
  display: inline-flex;
  align-items: center;
  gap: ${theme.spacing[3]}px;
  text-decoration: none;
  color: inherit;
  border-radius: ${theme.border.radius.small}px;
  &:focus-visible {
    outline: 2px solid ${theme.colors.interactive.border.primary.default};
    outline-offset: 4px;
  }
`,
);

const NavLink = styled(NextLink)(
  ({ theme }: { theme: Theme }) => `
  color: ${theme.colors.interactive.text.primary.normal};
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  padding: ${theme.spacing[2]}px ${theme.spacing[3]}px;
  border-radius: ${theme.border.radius.small}px;
  &:hover { background: ${theme.colors.interactive.background.primary.faded}; }
  &:focus-visible {
    outline: 2px solid ${theme.colors.interactive.border.primary.default};
    outline-offset: 2px;
  }
`,
);

/** The FlowLens mark: a lens (ring) with a focal point. */
const Mark = styled.span(
  ({ theme }: { theme: Theme }) => `
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${theme.colors.interactive.background.primary.default};
  display: inline-grid;
  place-items: center;
  &::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${theme.colors.interactive.background.primary.default};
  }
`,
);

export function AppShell({
  children,
  trailing,
  maxWidth = "1200px",
}: {
  children: ReactNode;
  trailing?: ReactNode;
  maxWidth?: `${number}px`;
}) {
  return (
    <>
      <Bar>
        <Box
          maxWidth={maxWidth}
          marginX="auto"
          paddingX={{ base: "spacing.5", m: "spacing.8" }}
          height="56px"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap="spacing.5"
        >
          <BrandLink href="/" aria-label="FlowLens — start a new test">
            <Mark aria-hidden />
            <Text weight="semibold" size="large" as="span">
              FlowLens
            </Text>
            <Box display={{ base: "none", m: "block" }}>
              <Text size="small" color="surface.text.gray.muted" as="span">
                Observe the journey. Discover the friction.
              </Text>
            </Box>
          </BrandLink>
          <Box display="flex" alignItems="center" gap="spacing.3">
            <NavLink href="/recents">Recents</NavLink>
            {trailing}
          </Box>
        </Box>
      </Bar>
      <Box as="main" maxWidth={maxWidth} marginX="auto" paddingX={{ base: "spacing.5", m: "spacing.8" }} paddingY="spacing.8">
        {children}
      </Box>
    </>
  );
}
