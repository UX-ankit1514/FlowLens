"use client";

import { useState } from "react";
import styled from "styled-components";
import {
  Badge,
  Box,
  Button,
  ChevronRightIcon,
  ImageIcon,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { ACTION_TYPE_LABEL } from "@/lib/journey/classify";
import { FLAG_VIEW, PATTERN_KIND_LABEL, formatElapsed } from "@/lib/presentation/labels";
import type { JourneyStep, JourneyTrace, StepResult } from "@/types";
import { EvidenceImage } from "./EvidenceImage";
import { EvidenceRefs } from "./EvidenceRefs";
import { PageLink } from "./FindingCard";
import { screenshotUrl } from "./Thumb";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const STEP_PREVIEW = 12;

const RowWrap = styled.div(
  ({ theme }: { theme: Theme }) => `
  border-bottom: 1px solid ${theme.colors.surface.border.gray.muted};
  scroll-margin-top: 96px;
  &:last-child { border-bottom: 0; }
  &[data-terminal="true"] { background: ${theme.colors.surface.background.gray.moderate}; border-radius: ${theme.border.radius.small}px; }
`,
);

const RowButton = styled.button(
  ({ theme }: { theme: Theme }) => `
  display: grid;
  grid-template-columns: 40px 48px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: ${theme.spacing[4]}px;
  width: 100%;
  padding: ${theme.spacing[4]}px ${theme.spacing[3]}px;
  background: transparent;
  border: 0;
  border-radius: ${theme.border.radius.small}px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease;
  @media (hover: hover) and (pointer: fine) {
    &:hover { background: ${theme.colors.surface.background.gray.moderate}; }
  }
  &:focus-visible { outline: 2px solid ${theme.colors.interactive.border.primary.default}; outline-offset: -2px; }
  .chevron { display: inline-flex; transition: transform 200ms ${EASE_OUT}; }
  &[aria-expanded="true"] .chevron { transform: rotate(90deg); }
  @media (max-width: 640px) {
    grid-template-columns: 36px minmax(0, 1fr) 16px;
    .elapsed, .flags { display: none; }
  }
`,
);

/** Height-to-content expand using grid rows; interruptible CSS transition, no layout jank. */
const Expand = styled.div`
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 220ms ${EASE_OUT}, opacity 160ms ease;
  &[data-open="true"] { grid-template-rows: 1fr; opacity: 1; }
  > div { overflow: hidden; min-height: 0; }
`;

export type TimelineState = {
  expanded: Set<string>;
  toggle: (ref: string) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  flaggedOnly: boolean;
  setFlaggedOnly: (v: boolean) => void;
  highlighted?: string;
};

export function JourneyTimeline({ sessionId, journey, state }: { sessionId: string; journey: JourneyTrace; state: TimelineState }) {
  const flagged = journey.steps.filter((s) => s.flags.length > 0 || s.terminal);
  const list = state.flaggedOnly ? flagged : journey.steps;
  const visible = state.showAll ? list : list.slice(0, STEP_PREVIEW);

  return (
    <Box display="flex" flexDirection="column" gap="spacing.6">
      <Patterns journey={journey} />

      {journey.steps.length === 0 ? (
        <Text color="surface.text.gray.muted">No steps were recorded for this session.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.4">
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="spacing.4">
            <Text size="small" color="surface.text.gray.muted">
              Select a step to see its purpose, result, timing and screenshot.
            </Text>
            <SegmentedControl
              accessibilityLabel="Which steps to show"
              size="small"
              value={state.flaggedOnly ? "flagged" : "all"}
              onChange={({ value }) => state.setFlaggedOnly(value === "flagged")}
            >
              <SegmentedControlItem value="all">{`All steps (${journey.steps.length})`}</SegmentedControlItem>
              <SegmentedControlItem value="flagged">{`Flagged (${flagged.length})`}</SegmentedControlItem>
            </SegmentedControl>
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            borderWidth="thin"
            borderColor="surface.border.gray.muted"
            borderRadius="medium"
            padding="spacing.2"
          >
            {visible.map((step) => (
              <StepRow
                key={step.ref}
                sessionId={sessionId}
                step={step}
                open={state.expanded.has(step.ref)}
                highlighted={state.highlighted === step.ref}
                onToggle={() => state.toggle(step.ref)}
              />
            ))}
          </Box>
          {list.length > STEP_PREVIEW ? (
            <Box>
              <Button variant="tertiary" size="small" onClick={() => state.setShowAll(!state.showAll)}>
                {state.showAll ? "Show fewer steps" : `Show all ${list.length} steps`}
              </Button>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function Patterns({ journey }: { journey: JourneyTrace }) {
  const [all, setAll] = useState(false);
  const ai = journey.patterns.some((p) => p.origin === "AI");
  const shown = all ? journey.patterns : journey.patterns.slice(0, 4);
  return (
    <Box display="flex" flexDirection="column" gap="spacing.3">
      <Box display="flex" alignItems="baseline" gap="spacing.3" flexWrap="wrap">
        <Text weight="semibold">Journey patterns</Text>
        <Text size="small" color="surface.text.gray.muted">
          {ai ? "Identified by the reasoning model from the recorded trace" : "Detected by rules from the recorded steps"}
        </Text>
      </Box>
      {journey.patterns.length === 0 ? (
        <Text size="small" color="surface.text.gray.muted">
          No repeats, backtracking, dead ends or other notable patterns were found in this trace.
        </Text>
      ) : (
        <Box display="flex" flexDirection="column" backgroundColor="surface.background.gray.moderate" borderRadius="medium" paddingX="spacing.5">
          {shown.map((p, i) => (
            <Box
              key={p.id}
              display="grid"
              gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "160px minmax(0, 1fr) auto" }}
              gap={{ base: "spacing.1", m: "spacing.5" }}
              paddingY="spacing.4"
              borderTopWidth={i === 0 ? undefined : "thin"}
              borderTopColor="surface.border.gray.muted"
              alignItems="baseline"
            >
              <Text size="xsmall" weight="semibold" color="surface.text.gray.muted">
                {PATTERN_KIND_LABEL[p.kind].toUpperCase()}
              </Text>
              <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
                <Text size="medium" weight="semibold" wordBreak="break-word">
                  {p.title}
                </Text>
                <Text size="small" color="surface.text.gray.subtle" truncateAfterLines={2} wordBreak="break-word">
                  {p.description}
                </Text>
              </Box>
              <Box maxWidth={{ base: "100%", m: "240px" }}>
                <EvidenceRefs refs={[...p.stepRefs, ...p.evidenceRefs]} empty="—" max={4} />
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {journey.patterns.length > 4 ? (
        <Box>
          <Button variant="tertiary" size="small" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer patterns" : `Show all ${journey.patterns.length} patterns`}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function StepRow({
  sessionId,
  step,
  open,
  highlighted,
  onToggle,
}: {
  sessionId: string;
  step: JourneyStep;
  open: boolean;
  highlighted: boolean;
  onToggle: () => void;
}) {
  const panelId = `step-panel-${step.ref}`;
  const purpose = step.statedPurpose || step.inferredPurpose || "No purpose recorded";
  const flags = step.flags.filter((f) => f.kind !== "WAIT");
  return (
    <RowWrap id={`step-${step.ref}`} data-terminal={Boolean(step.terminal)}>
      <RowButton type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} data-highlighted={highlighted}>
        <Text size="small" weight="semibold" color={highlighted ? "interactive.text.primary.normal" : "surface.text.gray.muted"}>
          {step.ref}
        </Text>
        <span className="elapsed">
          <Text size="small" color="surface.text.gray.muted">
            {step.elapsedMs !== undefined ? formatElapsed(step.elapsedMs) : "—"}
          </Text>
        </span>
        <Box display="flex" gap="spacing.3" alignItems="baseline" minWidth="0px">
          {!step.terminal && step.actionType !== "OTHER" ? (
            <Box flexShrink={0}>
              <Text size="small" color="surface.text.gray.muted">
                {ACTION_TYPE_LABEL[step.actionType]}
              </Text>
            </Box>
          ) : null}
          <Text size="medium" truncateAfterLines={open ? undefined : 1} wordBreak="break-word" weight={step.terminal ? "semibold" : "regular"}>
            {step.terminal ? terminalLabel(step) : purpose}
          </Text>
        </Box>
        <span className="flags">
          <Box display="flex" gap="spacing.2" alignItems="center" justifyContent="flex-end">
            {flags.slice(0, 2).map((f) => (
              <Badge key={f.kind} size="small" color={FLAG_VIEW[f.kind].color} emphasis="subtle">
                {FLAG_VIEW[f.kind].label}
              </Badge>
            ))}
            {flags.length > 2 ? (
              <Text size="xsmall" color="surface.text.gray.muted">
                +{flags.length - 2}
              </Text>
            ) : null}
            {step.hasScreenshot ? <ImageIcon size="small" color="surface.icon.gray.muted" /> : null}
          </Box>
        </span>
        <span className="chevron" aria-hidden>
          <ChevronRightIcon size="small" color="surface.icon.gray.muted" />
        </span>
      </RowButton>
      <Expand id={panelId} data-open={open} role="region" aria-label={`Details for step ${step.ref}`}>
        <div>{open ? <StepDetail sessionId={sessionId} step={step} /> : null}</div>
      </Expand>
    </RowWrap>
  );
}

function terminalLabel(step: JourneyStep): string {
  if (step.terminal === "COMPLETED") return "TinyFish marked the run complete";
  if (step.terminal === "FAILED") return `The run failed: ${step.statedPurpose}`;
  return "The run was cancelled";
}

const RESULT_SOURCE: Record<StepResult["source"], string> = {
  AGENT_REPORT: "From the agent's end-of-run report, matched to this step by wording",
  NEXT_STEP: "Inferred from the step that followed",
  RUN_RECORD: "From TinyFish's run record",
};

function StepDetail({ sessionId, step }: { sessionId: string; step: JourneyStep }) {
  const time = step.timestamp ? new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(step.timestamp)) : undefined;
  const timing = [
    time ? `at ${time}` : undefined,
    step.elapsedMs !== undefined ? `${formatElapsed(step.elapsedMs)} into the run` : undefined,
    step.duration ? `took ${step.duration}` : undefined,
  ].filter(Boolean);

  return (
    <Box
      display="grid"
      gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "minmax(0, 1fr) 280px" }}
      gap="spacing.6"
      paddingX={{ base: "spacing.3", m: "spacing.4" }}
      paddingLeft={{ base: "spacing.3", m: "spacing.11" }}
      paddingBottom="spacing.6"
      paddingTop="spacing.2"
    >
      <Box display="flex" flexDirection="column" gap="spacing.4" minWidth="0px">
        {step.statedPurpose ? (
          <Detail label="Agent's stated purpose" caption="Recorded live by TinyFish, verbatim">
            {step.statedPurpose}
          </Detail>
        ) : step.inferredPurpose ? (
          <Detail label="Inferred purpose" caption="Not recorded for this step; taken from the agent's end-of-run report">
            {step.inferredPurpose}
          </Detail>
        ) : (
          <Detail label="Purpose">Not recorded</Detail>
        )}
        {!step.terminal ? (
          <Detail label="Action" caption="Inferred from the wording of the purpose">
            {ACTION_TYPE_LABEL[step.actionType]}
          </Detail>
        ) : null}
        {step.agentAction ? (
          <Detail label="What the agent reported doing" caption={`Agent's end-of-run report ${step.agentAction.ref}, matched by wording`}>
            {step.agentAction.description}
          </Detail>
        ) : null}
        <Box display="flex" flexDirection="column" gap="spacing.1">
          <Text size="small" color="surface.text.gray.muted">
            Page
          </Text>
          {step.agentAction?.pageUrl ? (
            <Box display="flex" flexDirection="column" gap="spacing.1">
              <PageLink url={step.agentAction.pageUrl} />
              <Text size="xsmall" color="surface.text.gray.muted">{`Agent-reported (${step.agentAction.ref})`}</Text>
            </Box>
          ) : (
            <Text size="small" color="surface.text.gray.subtle">
              Not recorded for this step
            </Text>
          )}
        </Box>
        <Detail label="Result" caption={step.result ? RESULT_SOURCE[step.result.source] : undefined}>
          {step.result?.text ?? "Not recorded by TinyFish"}
        </Detail>
        <Detail label="Time">{timing.length ? timing.join(" · ") : "Not recorded"}</Detail>
        <Box display="flex" flexDirection="column" gap="spacing.1">
          <Text size="small" color="surface.text.gray.muted">
            Retries, blocks and flags
          </Text>
          {step.flags.length === 0 ? (
            <Text size="small" color="surface.text.gray.subtle">
              None
            </Text>
          ) : (
            step.flags.map((f) => (
              <Box key={f.kind} display="flex" gap="spacing.3" alignItems="center" flexWrap="wrap">
                <Badge size="small" color={FLAG_VIEW[f.kind].color} emphasis="subtle">
                  {FLAG_VIEW[f.kind].label}
                </Badge>
                <Text size="small" color="surface.text.gray.subtle">
                  {f.note}
                </Text>
                {f.relatedRefs.length ? <EvidenceRefs refs={f.relatedRefs} /> : null}
              </Box>
            ))
          )}
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing.1">
          <Text size="small" color="surface.text.gray.muted">
            Evidence
          </Text>
          <Text size="small" color="surface.text.gray.subtle">
            {[
              step.ref.startsWith("S") ? `${step.ref} step record${step.hasScreenshot ? " with screenshot" : ""}` : undefined,
              step.eventRef ? `${step.eventRef} live progress event` : undefined,
              step.agentAction ? `${step.agentAction.ref} agent report` : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Box>
      </Box>
      <Box>
        {step.hasScreenshot && step.stepId ? (
          <EvidenceImage src={screenshotUrl(sessionId, step.stepId)} refLabel={step.ref} action={step.statedPurpose} />
        ) : (
          <Box
            backgroundColor="surface.background.gray.moderate"
            borderRadius="small"
            padding="spacing.6"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text size="small" color="surface.text.gray.muted" textAlign="center">
              No screenshot for this step
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Detail({ label, caption, children }: { label: string; caption?: string; children: string }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      <Text size="medium" wordBreak="break-word">
        {children}
      </Text>
      {caption ? (
        <Text size="xsmall" color="surface.text.gray.muted">
          {caption}
        </Text>
      ) : null}
    </Box>
  );
}
