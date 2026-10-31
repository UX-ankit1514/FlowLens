"use client";

import type { ReactNode } from "react";
import { Box, Heading } from "@razorpay/blade/components";

/** A quiet bordered container with a small heading — the app's basic surface. */
export function Panel({
  title,
  trailing,
  children,
  id,
}: {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Box
      id={id}
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      padding="spacing.6"
    >
      {title ? (
        <Box display="flex" alignItems="center" justifyContent="space-between" gap="spacing.4" marginBottom="spacing.5">
          <Heading as="h2" size="small">
            {title}
          </Heading>
          {trailing}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}
