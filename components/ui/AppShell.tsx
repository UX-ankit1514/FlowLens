"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import styled from "styled-components";
import { Box, Text } from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { useConnections } from "@/components/connections/ConnectionsContext";
import { LogoMark } from "@/components/brand/Logo";

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

const NavButton = styled.button(
  ({ theme }: { theme: Theme }) => `
  display: inline-flex;
  align-items: center;
  gap: ${theme.spacing[2]}px;
  color: ${theme.colors.interactive.text.primary.normal};
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: ${theme.spacing[2]}px ${theme.spacing[3]}px;
  border-radius: ${theme.border.radius.small}px;
  &:hover { background: ${theme.colors.interactive.background.primary.faded}; }
  &:focus-visible {
    outline: 2px solid ${theme.colors.interactive.border.primary.default};
    outline-offset: 2px;
  }
`,
);

const Dot = styled.span<{ $on?: boolean }>(
  ({ theme, $on }: { theme: Theme; $on?: boolean }) => `
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${$on ? theme.colors.feedback.background.positive.intense : theme.colors.feedback.background.notice.intense};
`,
);

function ConnectionsButton() {
  const { config, openConnections } = useConnections();
  const connected = config?.tinyfish.connected;
  return (
    <NavButton
      type="button"
      onClick={openConnections}
      aria-label={config ? `Connections — TinyFish ${connected ? "connected" : "not connected"}` : "Connections"}
    >
      {config ? <Dot $on={connected} aria-hidden /> : null}
      Connections
    </NavButton>
  );
}

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
          <BrandLink href="/" aria-label="FlowLens home">
            <LogoMark size={26} />
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
            <ConnectionsButton />
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
