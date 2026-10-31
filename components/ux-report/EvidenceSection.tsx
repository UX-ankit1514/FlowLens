"use client";

import { useState } from "react";
import styled from "styled-components";
import {
  Box,
  Button,
  Collapsible,
  CollapsibleBody,
  CollapsibleLink,
  Heading,
  Text,
} from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { formatDateTime } from "@/lib/presentation/labels";
import type { EvidenceItem, TestSession, UsabilityReport } from "@/types";
import { EvidenceImage } from "./EvidenceImage";
import { PageLink } from "./FindingCard";
import { screenshotUrl } from "./Thumb";

const Pre = styled.pre(
  ({ theme }: { theme: Theme }) => `
  margin: 0;
  max-height: 420px;
  overflow: auto;
  padding: ${theme.spacing[5]}px;
  border-radius: ${theme.border.radius.small}px;
  background: ${theme.colors.surface.background.gray.moderate};
  font-family: ${theme.typography.fonts.family.code};
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`,
);

const KIND_GROUPS: Array<{ title: string; kinds: EvidenceItem["kind"][]; note?: string }> = [
  { title: "Agent checkpoint reports", kinds: ["AGENT_CHECKPOINT"], note: "What the agent reported for each success criterion." },
  { title: "Agent-reported actions", kinds: ["AGENT_ACTION"] },
  { title: "Agent-reported obstacles", kinds: ["AGENT_OBSTACLE"] },
];

const SCREENSHOT_PREVIEW = 12;

export function EvidenceSection({ session, report }: { session: TestSession; report: UsabilityReport }) {
  const allScreenshots = session.steps.filter((s) => s.hasScreenshot);
  const [showAll, setShowAll] = useState(false);
  const screenshots = showAll ? allScreenshots : allScreenshots.slice(0, SCREENSHOT_PREVIEW);

  // Opening a link to a hidden screenshot (e.g. #evidence-S30) reveals the full grid.
  if (!showAll && typeof window !== "undefined") {
    const target = window.location.hash.replace("#evidence-", "");
    if (allScreenshots.slice(SCREENSHOT_PREVIEW).some((s) => s.ref === target)) setShowAll(true);
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.8">
      <Box display="flex" flexDirection="column" gap="spacing.4">
        <SubHeading title="Screenshots captured during this run" note="Recorded by TinyFish at each agent step. Not every action has a screenshot." />
        {allScreenshots.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No screenshots were captured for this run. Evidence is limited to the timeline, URLs and agent reports.
          </Text>
        ) : (
          <Box display="grid" gridTemplateColumns={{ base: "repeat(2, minmax(0, 1fr))", m: "repeat(3, minmax(0, 1fr))" }} gap="spacing.5">
            {screenshots.map((step) => (
              <Box key={step.stepId} id={`evidence-${step.ref}`} display="flex" flexDirection="column" gap="spacing.2">
                <EvidenceImage src={screenshotUrl(session.id, step.stepId)} refLabel={step.ref} action={step.action} />
                <Text size="small" color="surface.text.gray.subtle" truncateAfterLines={2}>
                  <Text as="span" size="small" weight="semibold">
                    {step.ref}
                  </Text>{" "}
                  {step.action}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {allScreenshots.length > SCREENSHOT_PREVIEW ? (
          <Box>
            <Button variant="tertiary" size="small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer screenshots" : `Show all ${allScreenshots.length} screenshots`}
            </Button>
          </Box>
        ) : null}
      </Box>

      {KIND_GROUPS.map((group) => {
        const items = report.evidence.filter((e) => group.kinds.includes(e.kind));
        if (items.length === 0) return null;
        return (
          <Box key={group.title} display="flex" flexDirection="column" gap="spacing.4">
            <SubHeading title={group.title} note={group.note} />
            <Box display="flex" flexDirection="column">
              {items.map((item) => (
                <EvidenceRow key={item.ref} item={item} />
              ))}
            </Box>
          </Box>
        );
      })}

      <Box display="flex" flexDirection="column" gap="spacing.4">
        <SubHeading title="Pages visited" note="As reported by the agent, in order." />
        {report.urlsVisited.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            The agent didn&apos;t report any page URLs.
          </Text>
        ) : (
          <Box as="span" display="flex" flexDirection="column" gap="spacing.2">
            {report.urlsVisited.map((url, i) => (
              <Box key={`${url}-${i}`} display="flex" gap="spacing.3" minWidth="0px">
                <Text size="small" color="surface.text.gray.muted" as="span">
                  {i + 1}.
                </Text>
                <PageLink url={url} />
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing.4">
        <SubHeading title="Your observations" note="Human-authored notes added during the session. Kept separate from the agent's evidence." />
        {session.notes.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No notes were added.
          </Text>
        ) : (
          session.notes.map((note) => (
            <Box
              key={note.id}
              id={`evidence-${note.ref}`}
              padding="spacing.4"
              borderRadius="medium"
              backgroundColor="surface.background.gray.moderate"
            >
              <Text size="small" color="surface.text.gray.muted">
                {note.ref} · Designer note · {formatDateTime(note.createdAt)}
              </Text>
              <Text size="medium" wordBreak="break-word">
                {note.text}
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Collapsible>
        <CollapsibleLink>Raw TinyFish result</CollapsibleLink>
        <CollapsibleBody>
          <Box paddingTop="spacing.4" display="flex" flexDirection="column" gap="spacing.3">
            <Text size="small" color="surface.text.gray.muted">
              The provider&apos;s final payload, preserved unchanged. Everything above is derived from it and from the live
              event stream.
            </Text>
            <Pre tabIndex={0} aria-label="Raw TinyFish result JSON">
              {JSON.stringify(session.rawResult ?? null, null, 2)}
            </Pre>
          </Box>
        </CollapsibleBody>
      </Collapsible>
    </Box>
  );
}

function SubHeading({ title, note }: { title: string; note?: string }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Heading as="h3" size="small">
        {title}
      </Heading>
      {note ? (
        <Text size="small" color="surface.text.gray.muted">
          {note}
        </Text>
      ) : null}
    </Box>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <Box
      id={`evidence-${item.ref}`}
      display="grid"
      gridTemplateColumns="48px minmax(0, 1fr)"
      gap="spacing.4"
      paddingY="spacing.4"
      borderBottomWidth="thin"
      borderBottomColor="surface.border.gray.muted"
    >
      <Text size="small" weight="semibold" color="surface.text.gray.subtle">
        {item.ref}
      </Text>
      <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
        <Text size="medium" wordBreak="break-word">
          {item.label}
        </Text>
        {item.detail ? (
          <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">
            {item.detail}
          </Text>
        ) : null}
        {item.pageUrl ? (
          <Box>
            <PageLink url={item.pageUrl} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
