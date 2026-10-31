"use client";

import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  Badge,
  Box,
  Button,
  EyeIcon,
  GlobeIcon,
  Indicator,
  Link,
  Spinner,
  Text,
  ExternalLinkIcon,
} from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { displayUrl } from "@/lib/presentation/labels";
import type { ExecutionStatus, LiveViewStatus, SessionError } from "@/types";

const Frame = styled.div(
  ({ theme }: { theme: Theme }) => `
  border: 1px solid ${theme.colors.surface.border.gray.muted};
  border-radius: ${theme.border.radius.medium}px;
  background: ${theme.colors.surface.background.gray.intense};
  overflow: hidden;
`,
);

/** 16:10 stage — matches the agent's desktop browser and keeps the preview large. */
const Stage = styled.div(
  ({ theme }: { theme: Theme }) => `
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 320px;
  background: ${theme.colors.surface.background.gray.moderate};
`,
);

const LiveFrame = styled.iframe`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  /* Read-only: the designer observes, never controls, the agent's browser. */
  pointer-events: none;
`;

/** Transparent shield over the iframe so no input reaches the remote browser. */
const ReadOnlyShield = styled.div`
  position: absolute;
  inset: 0;
  cursor: default;
`;

const Centered = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
`;

type Props = {
  websiteUrl: string;
  streamingUrl?: string;
  liveViewStatus: LiveViewStatus;
  executionStatus: ExecutionStatus;
  hasRunId: boolean;
  error?: SessionError;
  reportHref?: string;
};

export function BrowserPreview({
  websiteUrl,
  streamingUrl,
  liveViewStatus,
  executionStatus,
  hasRunId,
  error,
  reportHref,
}: Props) {
  const showLive = Boolean(streamingUrl) && liveViewStatus === "AVAILABLE";

  return (
    <Frame>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap="spacing.4"
        paddingX="spacing.5"
        paddingY="spacing.3"
        borderBottomWidth="thin"
        borderBottomColor="surface.border.gray.muted"
      >
        <Box display="flex" alignItems="center" gap="spacing.3" minWidth="0px">
          <GlobeIcon size="medium" color="surface.icon.gray.muted" />
          <Text size="small" color="surface.text.gray.subtle" truncateAfterLines={1}>
            {displayUrl(websiteUrl)}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap="spacing.4" flexShrink={0}>
          {showLive ? <Indicator color="positive" emphasis="intense" size="small" accessibilityLabel="Live">Live</Indicator> : null}
          <Badge color="neutral" icon={EyeIcon} size="small">
            Read-only
          </Badge>
        </Box>
      </Box>

      {showLive && streamingUrl ? (
        <LiveStage key={streamingUrl} streamingUrl={streamingUrl} />
      ) : (
        <Stage>
          <Centered>
            <StageMessage
              executionStatus={executionStatus}
              liveViewStatus={liveViewStatus}
              hasRunId={hasRunId}
              hadStream={Boolean(streamingUrl)}
              error={error}
              reportHref={reportHref}
            />
          </Centered>
        </Stage>
      )}
    </Frame>
  );
}

/** The embedded stream. Keyed by URL so its loading state resets per stream. */
function LiveStage({ streamingUrl }: { streamingUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Stage>
        <LiveFrame
          src={streamingUrl}
          title="Live view of the agent's browser (read-only)"
          tabIndex={-1}
          onLoad={() => setLoaded(true)}
          referrerPolicy="no-referrer"
        />
        <ReadOnlyShield aria-hidden />
        {!loaded ? (
          <Centered>
            <Spinner size="large" accessibilityLabel="Loading live view" label="Loading live view…" labelPosition="bottom" />
          </Centered>
        ) : null}
      </Stage>
      {slow && !loaded ? (
        <Box paddingX="spacing.5" paddingY="spacing.3" borderTopWidth="thin" borderTopColor="surface.border.gray.muted">
          <Text size="small" color="surface.text.gray.muted">
            The preview is slow to load here.{" "}
            <Link href={streamingUrl} target="_blank" rel="noopener noreferrer" size="small" icon={ExternalLinkIcon} iconPosition="right">
              Open live view in a new tab
            </Link>
          </Text>
        </Box>
      ) : null}
    </>
  );
}

function StageMessage({
  executionStatus,
  liveViewStatus,
  hasRunId,
  hadStream,
  error,
  reportHref,
}: {
  executionStatus: ExecutionStatus;
  liveViewStatus: LiveViewStatus;
  hasRunId: boolean;
  hadStream: boolean;
  error?: SessionError;
  reportHref?: string;
}) {
  if (executionStatus === "CREATED" || executionStatus === "STARTING" || (executionStatus === "RUNNING" && liveViewStatus === "PENDING")) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap="spacing.4" maxWidth="420px">
        <Spinner size="xlarge" accessibilityLabel={hasRunId ? "Connecting to the live view" : "Preparing a cloud browser"} />
        <Text weight="semibold">{hasRunId ? "Connecting to the live view…" : "Preparing a cloud browser…"}</Text>
        <Text size="small" color="surface.text.gray.muted">
          The agent&apos;s browser appears here as soon as TinyFish provides a live stream, usually within a few
          seconds.
        </Text>
      </Box>
    );
  }
  if (executionStatus === "ANALYSING") {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap="spacing.4" maxWidth="420px">
        <Spinner size="xlarge" accessibilityLabel="Analysing results" />
        <Text weight="semibold">The agent has finished. Analysing the journey…</Text>
        <Text size="small" color="surface.text.gray.muted">
          TinyFish ends the live stream when a run finishes. The report will be ready in a moment.
        </Text>
      </Box>
    );
  }
  if (executionStatus === "FAILED") {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap="spacing.4" maxWidth="460px">
        <Text weight="semibold">The run didn&apos;t complete</Text>
        <Text size="small" color="surface.text.gray.muted">
          {error?.message ?? "TinyFish reported a failure."}
        </Text>
      </Box>
    );
  }
  if (executionStatus === "CANCELLED") {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap="spacing.4" maxWidth="420px">
        <Text weight="semibold">Test stopped</Text>
        <Text size="small" color="surface.text.gray.muted">
          The run was cancelled before the agent finished. It isn&apos;t reported as a completed test.
        </Text>
      </Box>
    );
  }
  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap="spacing.4" maxWidth="420px">
      <Text weight="semibold">The run has finished</Text>
      <Text size="small" color="surface.text.gray.muted">
        {hadStream
          ? "TinyFish's live stream isn't kept after a run, so the preview has ended. Step screenshots are in the report."
          : "TinyFish didn't provide a live stream for this run."}
      </Text>
      {reportHref ? <Button href={reportHref}>View report</Button> : null}
    </Box>
  );
}
