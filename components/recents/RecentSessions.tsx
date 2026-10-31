"use client";

import { useSyncExternalStore } from "react";
import { Badge, Box, Button, Card, CardBody, Heading, Text } from "@razorpay/blade/components";
import {
  TASK_OUTCOME_VIEW,
  displayUrl,
  formatDateTime,
  sessionStatusView,
} from "@/lib/presentation/labels";
import type { RecentSessionSummary } from "@/types";

export function RecentSessions({
  sessions,
  hosted = false,
  connected = true,
}: {
  sessions: RecentSessionSummary[];
  hosted?: boolean;
  connected?: boolean;
}) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.8">
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="spacing.5" flexWrap="wrap">
        <Box maxWidth="720px" display="flex" flexDirection="column" gap="spacing.2">
          <Heading as="h1" size="xlarge">
            Recent tests
          </Heading>
          <Text size="large" color="surface.text.gray.subtle">
            {hosted
              ? "Tests run with your TinyFish key. Reopen any of them to see its journey, evidence and full report."
              : "Reports saved privately on this Mac. Reopen any session to show its task, journey, evidence and full report—even after restarting FlowLens."}
          </Text>
        </Box>
        <Button href="/">New test</Button>
      </Box>

      <Box
        backgroundColor="surface.background.gray.moderate"
        borderRadius="medium"
        padding="spacing.5"
      >
        {hosted ? (
          <Text size="small" color="surface.text.gray.muted">
            From your TinyFish account · Only visible with the key that ran each test · Notes and validation marks
            aren&apos;t stored permanently on the hosted version
          </Text>
        ) : (
          <Text size="small" color="surface.text.gray.muted">
            Local only · Stored in <Text as="span" weight="semibold">.flowlens-data/sessions</Text> inside this
            project · Excluded from Git
          </Text>
        )}
      </Box>

      {sessions.length === 0 ? (
        <Box
          borderWidth="thin"
          borderColor="surface.border.gray.muted"
          borderRadius="medium"
          padding={{ base: "spacing.7", m: "spacing.10" }}
          display="flex"
          flexDirection="column"
          alignItems="center"
          textAlign="center"
          gap="spacing.4"
        >
          <Heading as="h2" size="medium">
            {connected ? "No saved tests yet" : "Connect TinyFish to see your tests"}
          </Heading>
          <Box maxWidth="520px">
            <Text color="surface.text.gray.muted">
              {!connected
                ? "Your tests are linked to your TinyFish key. Open Connections at the top of the page and add it."
                : hosted
                  ? "Your next test will appear here as soon as it starts."
                  : "Your next test will appear here as soon as it starts, and its complete report will remain available after the local server restarts."}
            </Text>
          </Box>
          <Button href="/">Run your first saved test</Button>
        </Box>
      ) : (
        <Box display="grid" gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "repeat(2, minmax(0, 1fr))" }} gap="spacing.5">
          {sessions.map((session) => (
            <RecentCard key={session.id} session={session} />
          ))}
        </Box>
      )}
    </Box>
  );
}

const noopSubscribe = () => () => {};

/** Dates are formatted in the viewer's own time zone, after hydration (the server may be in UTC). */
function useLocalDate(iso?: string): string {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return hydrated ? formatDateTime(iso) : "…";
}

function RecentCard({ session }: { session: RecentSessionSummary }) {
  const runOn = useLocalDate(session.createdAt);
  const execution = sessionStatusView(session);
  const outcome = session.taskOutcome ? TASK_OUTCOME_VIEW[session.taskOutcome] : undefined;

  return (
    <Card elevation="lowRaised" padding="spacing.7">
      <CardBody>
        <Box display="flex" flexDirection="column" gap="spacing.5" height="100%">
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="spacing.4">
            <Box minWidth="0px" display="flex" flexDirection="column" gap="spacing.2">
              <Heading as="h2" size="medium" wordBreak="break-word">
                {session.title}
              </Heading>
              <Text size="small" color="surface.text.gray.muted" truncateAfterLines={1}>
                {displayUrl(session.websiteUrl)}
              </Text>
            </Box>
            <Badge color={execution.color} emphasis="subtle">
              {execution.label}
            </Badge>
          </Box>

          <Text color="surface.text.gray.subtle" truncateAfterLines={3} wordBreak="break-word">
            {session.goal}
          </Text>

          <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="spacing.4">
            <Meta label="Run on" value={runOn} />
            <Meta label="Task outcome" value={outcome?.label ?? "Not available"} />
            <Meta label="Activity" value={`${session.eventCount} events`} />
            <Meta label="Evidence" value={`${session.stepCount} recorded steps`} />
          </Box>

          <Box display="flex" gap="spacing.3" flexWrap="wrap" marginTop="auto">
            <Button variant="secondary" href={`/sessions/${session.id}`}>
              Open overview
            </Button>
            {session.hasReport ? <Button href={`/sessions/${session.id}/report`}>View report</Button> : null}
          </Box>
        </Box>
      </CardBody>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      <Text size="small" weight="medium" truncateAfterLines={2}>
        {value}
      </Text>
    </Box>
  );
}
