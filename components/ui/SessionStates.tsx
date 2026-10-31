"use client";

import { Box, Button, EmptyState, Skeleton, Text } from "@razorpay/blade/components";

export function SessionNotFound() {
  return (
    <Box paddingY="spacing.10" display="flex" justifyContent="center">
      <EmptyState
        title="Session not found"
        description="FlowLens couldn't find this test. It may have been run with a different TinyFish key; connect that key to open it."
      >
        <Button href="/">Start a new test</Button>
      </EmptyState>
    </Box>
  );
}

export function SessionLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Box paddingY="spacing.10" display="flex" flexDirection="column" alignItems="center" gap="spacing.4">
      <Text weight="semibold">FlowLens couldn&apos;t load this session.</Text>
      <Text size="small" color="surface.text.gray.muted">
        Check that FlowLens is still running, then try again.
      </Text>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </Box>
  );
}

export function SessionLoading() {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.5" aria-busy="true" aria-label="Loading session">
      <Skeleton height="32px" width="40%" borderRadius="medium" />
      <Box
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "minmax(0, 7fr) minmax(320px, 3fr)" }}
        gap="spacing.7"
      >
        <Skeleton height="480px" width="100%" borderRadius="medium" />
        <Skeleton height="480px" width="100%" borderRadius="medium" />
      </Box>
    </Box>
  );
}
