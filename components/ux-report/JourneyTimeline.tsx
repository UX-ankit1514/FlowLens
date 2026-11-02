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
import { STEP_TONE_LABEL, isFrictionStep, refName, stepTone, type StepTone } from "@/lib/presentation/report-view";
import type { JourneyStep, JourneyTrace, StepResult } from "@/types";
import { EvidenceImage } from "./EvidenceImage";
import { EvidenceRefs, RefText } from "./EvidenceRefs";
import { PageLink } from "./FindingCard";
import { useReportNav } from "./nav";
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
  frictionOnly: boolean;
  setFrictionOnly: (v: boolean) => void;
  highlighted?: string;
};

export function JourneyTimeline({ sessionId, journey, state }: { sessionId: string; journey: JourneyTrace; state: TimelineState }) {
  const friction = journey.steps.filter((s) => isFrictionStep(s) || (s.terminal && s.terminal !== "COMPLETED"));
  const list = state.frictionOnly ? friction : journey.steps;
  const visible = state.showAll ? list : list.slice(0, STEP_PREVIEW);

  return (
    <Box display="flex" flexDirection="column" gap="spacing.8">
      {journey.completeness !== "STEP_LEVEL" ? (
        <Box backgroundColor="feedback.background.notice.subtle" borderRadius="medium" padding="spacing.4">
          <Text size="small">{journey.completenessNote}</Text>
        </Box>
      ) : null}

      {journey.steps.length > 0 ? <FrictionStrip journey={journey} /> : null}

      <Patterns journey={journey} />

      {journey.steps.length === 0 ? (
        <Text color="surface.text.gray.muted">No steps were recorded for this session.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.4">
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="spacing.4">
            <Text weight="semibold">Step by step</Text>
            <SegmentedControl
              accessibilityLabel="Which steps to show"
              size="small"
              value={state.frictionOnly ? "friction" : "all"}
              onChange={({ value }) => state.setFrictionOnly(value === "friction")}
            >
              <SegmentedControlItem value="all">{`All steps (${journey.steps.length})`}</SegmentedControlItem>
              <SegmentedControlItem value="friction" isDisabled={friction.length === 0}>{`Where it struggled (${friction.length})`}</SegmentedControlItem>
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

const TONE_ORDER: StepTone[] = ["smooth", "friction", "error", "setup", "note", "end"];

const Strip = styled.div(
  ({ theme }: { theme: Theme }) => `
  display: flex;
  gap: 2px;
  height: 36px;
  .cell {
    flex: 1 1 0;
    min-width: 4px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    background: ${theme.colors.surface.background.gray.moderate};
    box-shadow: inset 0 0 0 1px ${theme.colors.surface.border.gray.muted};
    transition: transform 150ms ease, filter 150ms ease;
  }
  .cell[data-tone="friction"] { background: ${theme.colors.feedback.background.notice.intense}; box-shadow: none; }
  .cell[data-tone="error"] { background: ${theme.colors.feedback.background.negative.intense}; box-shadow: none; }
  .cell[data-tone="setup"] { background: ${theme.colors.feedback.background.information.intense}; box-shadow: none; }
  .cell[data-tone="note"] { background: ${theme.colors.surface.background.gray.subtle}; box-shadow: inset 0 0 0 1px ${theme.colors.surface.border.gray.normal}; }
  .cell[data-tone="end"] { background: ${theme.colors.surface.text.gray.normal}; box-shadow: none; }
  @media (hover: hover) and (pointer: fine) {
    .cell:hover { transform: scaleY(1.12); filter: brightness(0.92); }
  }
  .cell:focus-visible { outline: 2px solid ${theme.colors.interactive.border.primary.default}; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .cell { transition: none; } }
`,
);

const Swatch = styled.span(
  ({ theme }: { theme: Theme }) => `
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
  background: ${theme.colors.surface.background.gray.moderate};
  box-shadow: inset 0 0 0 1px ${theme.colors.surface.border.gray.muted};
  &[data-tone="friction"] { background: ${theme.colors.feedback.background.notice.intense}; box-shadow: none; }
  &[data-tone="error"] { background: ${theme.colors.feedback.background.negative.intense}; box-shadow: none; }
  &[data-tone="setup"] { background: ${theme.colors.feedback.background.information.intense}; box-shadow: none; }
  &[data-tone="note"] { background: ${theme.colors.surface.background.gray.subtle}; box-shadow: inset 0 0 0 1px ${theme.colors.surface.border.gray.normal}; }
  &[data-tone="end"] { background: ${theme.colors.surface.text.gray.normal}; box-shadow: none; }
`,
);

/** The whole journey at a glance: one cell per step, coloured by what happened there. */
function FrictionStrip({ journey }: { journey: JourneyTrace }) {
  const { go } = useReportNav();
  const tones = journey.steps.map(stepTone);
  const present = TONE_ORDER.filter((t) => tones.includes(t));
  const struggled = journey.steps.filter(isFrictionStep).length;
  const real = journey.steps.filter((s) => !s.terminal).length;

  return (
    <Box display="flex" flexDirection="column" gap="spacing.3">
      <Box display="flex" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap="spacing.3">
        <Text weight="semibold">Journey at a glance</Text>
        <Text size="small" color="surface.text.gray.muted">
          {struggled === 0 ? `${real} steps, none with friction` : `${struggled} of ${real} steps show friction`}
        </Text>
      </Box>
      <Strip role="group" aria-label="Journey overview, one button per step">
        {journey.steps.map((step, i) => {
          const tone = tones[i];
          const what = step.terminal ? "End of run" : step.statedPurpose || step.inferredPurpose || "Step";
          const label = `${refName(step.ref)}: ${what}${tone !== "smooth" && tone !== "end" ? ` (${STEP_TONE_LABEL[tone].toLowerCase()})` : ""}`;
          return <button key={step.ref} type="button" className="cell" data-tone={tone} title={label} aria-label={label} onClick={() => go(step.ref)} />;
        })}
      </Strip>
      <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap="spacing.3">
        <Box display="flex" columnGap="spacing.5" rowGap="spacing.2" flexWrap="wrap">
          {present.map((tone) => (
            <Box key={tone} display="flex" gap="spacing.2" alignItems="center">
              <Swatch data-tone={tone} aria-hidden />
              <Text size="xsmall" color="surface.text.gray.subtle">
                {STEP_TONE_LABEL[tone]}
              </Text>
            </Box>
          ))}
        </Box>
        <Text size="xsmall" color="surface.text.gray.muted">
          Start → end
        </Text>
      </Box>
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
        <Text weight="semibold">What stands out in the path</Text>
        <Text size="small" color="surface.text.gray.muted">
          {ai ? "Spotted by AI in the recorded steps" : "Spotted by FlowLens rules in the recorded steps"}
        </Text>
      </Box>
      {journey.patterns.length === 0 ? (
        <Text size="small" color="surface.text.gray.muted">
          Nothing notable: no repeats, going back, dead ends or detours were found.
        </Text>
      ) : (
        <Box display="flex" flexDirection="column" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" paddingX="spacing.5">
          {shown.map((p, i) => (
            <Box
              key={p.id}
              display="grid"
              gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "180px minmax(0, 1fr)" }}
              gap={{ base: "spacing.2", m: "spacing.5" }}
              paddingY="spacing.4"
              borderTopWidth={i === 0 ? undefined : "thin"}
              borderTopColor="surface.border.gray.muted"
              alignItems="baseline"
            >
              <Box>
                <Badge size="small" color="neutral" emphasis="subtle">
                  {PATTERN_KIND_LABEL[p.kind]}
                </Badge>
              </Box>
              <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
                <Text size="medium" weight="semibold" wordBreak="break-word">
                  {p.title}
                </Text>
                <RefText size="small" color="surface.text.gray.subtle" truncateAfterLines={3}>
                  {p.description}
                </RefText>
                {p.stepRefs.length ? <EvidenceRefs refs={p.stepRefs} max={6} /> : null}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {journey.patterns.length > 4 ? (
        <Box>
          <Button variant="tertiary" size="small" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${journey.patterns.length}`}
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
          {step.terminal ? "End" : String(step.number)}
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
      <Expand id={panelId} data-open={open} role="region" aria-label={`Details for ${refName(step.ref)}`}>
        <div>{open ? <StepDetail sessionId={sessionId} step={step} /> : null}</div>
      </Expand>
    </RowWrap>
  );
}

function terminalLabel(step: JourneyStep): string {
  if (step.terminal === "COMPLETED") return "The agent finished the run";
  if (step.terminal === "FAILED") return `The run failed: ${step.statedPurpose}`;
  return "The run was stopped";
}

const RESULT_SOURCE: Record<StepResult["source"], string> = {
  AGENT_REPORT: "From the agent's end-of-run report",
  NEXT_STEP: "Worked out from the step that followed",
  RUN_RECORD: "From the run record",
};

function StepDetail({ sessionId, step }: { sessionId: string; step: JourneyStep }) {
  const time = step.timestamp ? new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(step.timestamp)) : undefined;
  const timing = [
    step.elapsedMs !== undefined ? `${formatElapsed(step.elapsedMs)} into the run` : undefined,
    step.duration ? `took ${step.duration}` : undefined,
    time ? `at ${time}` : undefined,
  ].filter(Boolean);

  return (
    <Box
      display="grid"
      gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "minmax(0, 1fr) 360px" }}
      gap="spacing.6"
      paddingX={{ base: "spacing.3", m: "spacing.4" }}
      paddingLeft={{ base: "spacing.3", m: "spacing.11" }}
      paddingBottom="spacing.6"
      paddingTop="spacing.2"
    >
      <Box display="flex" flexDirection="column" gap="spacing.4" minWidth="0px">
        {step.statedPurpose ? (
          <Detail label="What the agent was trying to do" caption="In the agent's own words">
            {step.statedPurpose}
          </Detail>
        ) : step.inferredPurpose ? (
          <Detail label="What the agent was trying to do" caption="Not recorded for this step; taken from the agent's end-of-run report">
            {step.inferredPurpose}
          </Detail>
        ) : (
          <Detail label="What the agent was trying to do">Not recorded</Detail>
        )}
        {step.agentAction && step.agentAction.description !== step.statedPurpose ? (
          <Detail label="What the agent says it did" caption="From its end-of-run report">
            {step.agentAction.description}
          </Detail>
        ) : null}
        <Detail label="What happened" caption={step.result ? RESULT_SOURCE[step.result.source] : undefined}>
          {step.result?.text ?? "Not recorded"}
        </Detail>
        {step.agentAction?.pageUrl ? (
          <Box display="flex" flexDirection="column" gap="spacing.1">
            <Text size="small" color="surface.text.gray.muted">
              Page
            </Text>
            <PageLink url={step.agentAction.pageUrl} />
          </Box>
        ) : null}
        {step.flags.length ? (
          <Box display="flex" flexDirection="column" gap="spacing.2">
            <Text size="small" color="surface.text.gray.muted">
              Worth noticing
            </Text>
            {step.flags.map((f) => (
              <Box key={f.kind} display="flex" gap="spacing.3" alignItems="flex-start" flexWrap="wrap">
                <Badge size="small" color={FLAG_VIEW[f.kind].color} emphasis="subtle">
                  {FLAG_VIEW[f.kind].label}
                </Badge>
                <Box flex="1" minWidth="200px">
                  <RefText size="small" color="surface.text.gray.subtle">
                    {f.note}
                  </RefText>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
        <Detail label="Time">{timing.length ? timing.join(" · ") : "Not recorded"}</Detail>
      </Box>
      <Box>
        {step.hasScreenshot && step.stepId ? (
          <EvidenceImage src={screenshotUrl(sessionId, step.stepId)} refLabel={refName(step.ref)} action={step.statedPurpose} />
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
