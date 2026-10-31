"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  announce,
  ArrowLeftIcon,
  Badge,
  Box,
  Button,
  ExternalLinkIcon,
  FileTextIcon,
  Heading,
  Link,
  Spinner,
  StopCircleIcon,
  Text,
} from "@razorpay/blade/components";
import { useNow, useSession } from "@/lib/client/useSession";
import { formatElapsed, hostOf, sessionStatusView } from "@/lib/presentation/labels";
import type { SessionError } from "@/types";
import { Panel } from "@/components/ui/Panel";
import { SessionLoadFailed, SessionLoading, SessionNotFound } from "@/components/ui/SessionStates";
import { ActivityTimeline } from "./ActivityTimeline";
import { BrowserPreview } from "./BrowserPreview";
import { ObservationNotes } from "./ObservationNotes";
import { PersonaSummary } from "./PersonaSummary";

const ERROR_TITLES: Record<SessionError["kind"], string> = {
  CONFIGURATION: "FlowLens isn't fully set up",
  INVALID_API_KEY: "TinyFish API key problem",
  INSUFFICIENT_CREDITS: "Not enough TinyFish balance",
  RATE_LIMITED: "TinyFish is busy",
  INVALID_REQUEST: "TinyFish couldn't accept this test",
  PROVIDER_ERROR: "TinyFish error",
  NETWORK: "Connection problem",
  TIMEOUT: "The run timed out",
  AGENT_FAILURE: "The agent couldn't run this test",
  UNKNOWN: "The test couldn't finish",
};

export function LiveSession({ id }: { id: string }) {
  const router = useRouter();
  const { session, loadError, connection, refetch } = useSession(id);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string>();
  const lastAnnounced = useRef<string>(undefined);

  const status = session ? sessionStatusView(session) : undefined;
  const now = useNow(Boolean(status?.busy));

  useEffect(() => {
    if (status && lastAnnounced.current !== status.label) {
      if (lastAnnounced.current !== undefined) announce(`Session status: ${status.label}`);
      lastAnnounced.current = status.label;
    }
  }, [status]);

  if (loadError === "not-found") return <SessionNotFound />;
  if (loadError === "network" && !session) return <SessionLoadFailed onRetry={() => void refetch()} />;
  if (!session || !status) return <SessionLoading />;

  const { definition, executionStatus } = session;
  const terminal = executionStatus === "COMPLETED" || executionStatus === "FAILED" || executionStatus === "CANCELLED";
  const canStop =
    (executionStatus === "CREATED" || executionStatus === "STARTING" || executionStatus === "RUNNING") &&
    !session.cancelRequested;
  const liveUrl = session.liveViewStatus === "AVAILABLE" ? session.streamingUrl : undefined;
  const reportHref = session.report ? `/sessions/${id}/report` : undefined;
  const startMs = Date.parse(session.startedAt ?? session.createdAt);
  const endMs = session.finishedAt ? Date.parse(session.finishedAt) : now;
  const title = definition.sessionName || definition.goal;

  async function stop() {
    setCancelling(true);
    setCancelMessage(undefined);
    try {
      const res = await fetch(`/api/sessions/${id}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { accepted?: boolean; message?: string };
      if (!body.accepted) setCancelMessage(body.message ?? "The test couldn't be stopped.");
    } catch {
      setCancelMessage("FlowLens couldn't reach its server to stop the test.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.6">
      <Box display="flex" flexDirection="column" gap="spacing.4">
        <Box>
          <Link href="/" icon={ArrowLeftIcon} size="small">
            New test
          </Link>
        </Box>
        <Box
          display="flex"
          flexWrap="wrap"
          alignItems={{ base: "flex-start", m: "center" }}
          justifyContent="space-between"
          gap="spacing.5"
        >
          <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px" flex="1 1 360px">
            <Heading as="h1" size="large" wordBreak="break-word">
              {title}
            </Heading>
            <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
              <Badge color={status.color} emphasis={status.busy ? "subtle" : "intense"}>
                {status.label}
              </Badge>
              {status.busy ? <Spinner size="medium" accessibilityLabel={status.label} /> : null}
              <Text size="small" color="surface.text.gray.muted">
                {hostOf(definition.websiteUrl)} · {formatElapsed(endMs - startMs)}
                {session.providerRunId ? ` · Run ${session.providerRunId.slice(0, 8)}` : ""}
              </Text>
            </Box>
          </Box>
          <Box display="flex" gap="spacing.3" flexWrap="wrap">
            {canStop || (session.cancelRequested && !terminal) ? (
              <Button
                variant="secondary"
                icon={StopCircleIcon}
                onClick={stop}
                isLoading={cancelling}
                isDisabled={!canStop}
              >
                {session.cancelRequested ? "Stopping…" : "Stop test"}
              </Button>
            ) : null}
            {liveUrl ? (
              <Button variant="tertiary" icon={ExternalLinkIcon} iconPosition="right" href={liveUrl} target="_blank" rel="noopener noreferrer">
                Open live view
              </Button>
            ) : null}
            {reportHref ? (
              <Button icon={FileTextIcon} href={reportHref}>
                View report
              </Button>
            ) : null}
          </Box>
        </Box>
      </Box>

      {cancelMessage ? (
        <Alert color="notice" isFullWidth onDismiss={() => setCancelMessage(undefined)} description={cancelMessage} />
      ) : null}

      {executionStatus === "FAILED" && session.error ? (
        <Alert
          color="negative"
          isFullWidth
          isDismissible={false}
          title={ERROR_TITLES[session.error.kind]}
          description={
            session.error.providerMessage && session.error.providerMessage !== session.error.message
              ? `${session.error.message} TinyFish said: “${session.error.providerMessage}”`
              : session.error.message
          }
          actions={{
            primary: { text: "Try again with the same setup", onClick: () => router.push(`/?from=${id}`) },
            ...(session.error.helpUrl
              ? { secondary: { text: "Open help", href: session.error.helpUrl, target: "_blank", rel: "noopener noreferrer" } }
              : {}),
          }}
        />
      ) : null}

      {connection === "reconnecting" && !terminal ? (
        <Alert
          color="notice"
          isFullWidth
          isDismissible={false}
          description="Reconnecting to live updates… Missed events are replayed automatically once the connection returns."
        />
      ) : null}

      <Box
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "minmax(0, 7fr) minmax(320px, 3fr)" }}
        gap="spacing.7"
        alignItems="start"
      >
        <Box display="flex" flexDirection="column" gap="spacing.3">
          <BrowserPreview
            websiteUrl={definition.websiteUrl}
            streamingUrl={session.streamingUrl}
            liveViewStatus={session.liveViewStatus}
            executionStatus={executionStatus}
            hasRunId={Boolean(session.providerRunId)}
            error={session.error}
            reportHref={reportHref}
          />
          <Text size="small" color="surface.text.gray.muted">
            You&apos;re watching TinyFish&apos;s cloud browser. The view is read-only — the agent chooses every action
            itself.
          </Text>
        </Box>

        <Box display="flex" flexDirection="column" gap="spacing.5">
          <Panel title="Task">
            <PersonaSummary definition={definition} />
          </Panel>
          <Panel
            title="Activity"
            trailing={
              <Text size="small" color="surface.text.gray.muted">
                {session.events.filter((e) => e.source === "provider").length} from TinyFish
              </Text>
            }
          >
            <ActivityTimeline
              events={session.events}
              originTime={session.createdAt}
              isLive={!terminal}
            />
          </Panel>
          <Panel title="Your observations">
            <ObservationNotes
              sessionId={id}
              notes={session.notes}
              originTime={session.createdAt}
              onAdded={() => void refetch()}
            />
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}
