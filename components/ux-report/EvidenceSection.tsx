"use client";

import styled from "styled-components";
import { Box, Text } from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { CHECKPOINT_VIEW, FINDING_KIND_VIEW, VERIFICATION_VIEW, formatDateTime } from "@/lib/presentation/labels";
import { SEVERITY_ORDER, SEVERITY_VIEW, refName } from "@/lib/presentation/report-view";
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

const Group = styled.details(
  ({ theme }: { theme: Theme }) => `
  border-bottom: 1px solid ${theme.colors.surface.border.gray.muted};
  scroll-margin-top: 96px;
  > summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: ${theme.spacing[4]}px;
    padding: ${theme.spacing[5]}px ${theme.spacing[2]}px;
    border-radius: ${theme.border.radius.small}px;
  }
  > summary::-webkit-details-marker { display: none; }
  > summary::after { content: "+"; color: ${theme.colors.surface.text.gray.muted}; font-size: 16px; }
  &[open] > summary::after { content: "−"; }
  > summary:focus-visible { outline: 2px solid ${theme.colors.interactive.border.primary.default}; outline-offset: -2px; }
  @media (hover: hover) and (pointer: fine) {
    > summary:hover { background: ${theme.colors.surface.background.gray.moderate}; }
  }
  > .group-body { padding: 0 ${theme.spacing[2]}px ${theme.spacing[6]}px; }
`,
);

/** Which evidence group holds a reference, so links can open it. */
export function evidenceGroupOf(ref: string): string | undefined {
  if (/^[AO]\d+$/.test(ref)) return "agent-report";
  if (/^N\d+$/.test(ref)) return "notes";
  if (/^E\d+$/.test(ref)) return "events";
  if (/^S\d+$/.test(ref)) return "screenshots";
  return undefined;
}

export function EvidenceSection({
  session,
  report,
  open,
  setOpen,
}: {
  session: TestSession;
  report: UsabilityReport;
  open: Set<string>;
  setOpen: (id: string, isOpen: boolean) => void;
}) {
  const d = session.definition;
  const screenshots = session.steps.filter((s) => s.hasScreenshot);
  const agentItems = report.evidence.filter((e) => e.kind === "AGENT_ACTION" || e.kind === "AGENT_OBSTACLE");
  const events = report.evidence.filter((e) => e.kind === "TIMELINE_EVENT");

  const group = (id: string, title: string, meta: string, body: React.ReactNode) => (
    <Group id={`group-${id}`} open={open.has(id)} onToggle={(e) => setOpen(id, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Text weight="semibold">{title}</Text>
        <Box flexShrink={0} marginLeft="auto">
          <Text size="small" color="surface.text.gray.muted">
            {meta}
          </Text>
        </Box>
      </summary>
      <div className="group-body">{open.has(id) ? body : null}</div>
    </Group>
  );

  return (
    <Box display="flex" flexDirection="column" borderTopWidth="thin" borderTopColor="surface.border.gray.muted">
      {group(
        "setup",
        "What you asked the agent to do",
        "Persona, goal and criteria, as you wrote them",
        <Box display="flex" flexDirection="column" gap="spacing.4">
          <Field label="Website">
            <PageLink url={d.websiteUrl} />
          </Field>
          <Field label="Persona (as supplied)">
            <Box whiteSpace="pre-line">
              <Text size="medium" wordBreak="break-word">
                {d.persona.description}
              </Text>
            </Box>
          </Field>
          <Field label="Goal">
            <Text size="medium" wordBreak="break-word">
              {d.goal}
            </Text>
          </Field>
          <Field label="Success criteria">
            <Box display="flex" flexDirection="column" gap="spacing.1">
              {d.successCriteria.map((c, i) => (
                <Text key={i} size="medium" wordBreak="break-word">{`C${i + 1}. ${c}`}</Text>
              ))}
            </Box>
          </Field>
        </Box>,
      )}
      {group(
        "agent-account",
        "The agent's summary",
        "In its own words, at the end of the run",
        <Box display="flex" flexDirection="column" gap="spacing.4">
          <Field label="Outcome summary">
            <Text size="medium" wordBreak="break-word">
              {report.agentSummary ?? "Not provided"}
            </Text>
          </Field>
          <Field label="What the agent found">
            <Text size="medium" wordBreak="break-word">
              {report.finalAnswer ?? "Not provided"}
            </Text>
          </Field>
        </Box>,
      )}
      {group(
        "screenshots",
        "Screenshots",
        `${screenshots.length} captured during the run`,
        screenshots.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No screenshots were captured for this run.
          </Text>
        ) : (
          <Box display="grid" gridTemplateColumns={{ base: "repeat(2, minmax(0, 1fr))", m: "repeat(4, minmax(0, 1fr))" }} gap="spacing.4">
            {screenshots.map((step) => (
              <Box key={step.stepId} id={`evidence-${step.ref}`} display="flex" flexDirection="column" gap="spacing.2">
                <EvidenceImage src={screenshotUrl(session.id, step.stepId)} refLabel={step.ref} action={step.action} />
                <Text size="xsmall" color="surface.text.gray.subtle" truncateAfterLines={2}>
                  {`${refName(step.ref)} · ${step.action}`}
                </Text>
              </Box>
            ))}
          </Box>
        ),
      )}
      {group(
        "agent-report",
        "Actions and obstacles the agent reported",
        `${agentItems.length} ${agentItems.length === 1 ? "item" : "items"}`,
        agentItems.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            The agent didn&apos;t report any actions or obstacles.
          </Text>
        ) : (
          <Box display="flex" flexDirection="column">
            {agentItems.map((item) => (
              <EvidenceRow key={item.ref} item={item} />
            ))}
          </Box>
        ),
      )}
      {group(
        "pages",
        "Pages visited",
        `${report.urlsVisited.length} reported by the agent`,
        report.urlsVisited.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            The agent didn&apos;t report any page URLs.
          </Text>
        ) : (
          <Box display="flex" flexDirection="column" gap="spacing.2">
            {report.urlsVisited.map((url, i) => (
              <Box key={`${url}-${i}`} display="flex" gap="spacing.3" minWidth="0px">
                <Text size="small" color="surface.text.gray.muted">{`${i + 1}.`}</Text>
                <PageLink url={url} />
              </Box>
            ))}
          </Box>
        ),
      )}
      {group(
        "events",
        "Live event log",
        `${events.length} events from TinyFish`,
        events.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No live events were received for this session.
          </Text>
        ) : (
          <Box display="flex" flexDirection="column">
            {events.map((item) => (
              <EvidenceRow key={item.ref} item={item} />
            ))}
          </Box>
        ),
      )}
      {group(
        "notes",
        "Your notes",
        `${session.notes.length} ${session.notes.length === 1 ? "note" : "notes"}`,
        session.notes.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No notes were added.
          </Text>
        ) : (
          <Box display="flex" flexDirection="column" gap="spacing.3">
            {session.notes.map((note) => (
              <Box key={note.id} id={`evidence-${note.ref}`} padding="spacing.4" borderRadius="medium" backgroundColor="surface.background.gray.moderate">
                <Text size="small" color="surface.text.gray.muted">{`${refName(note.ref)} · ${formatDateTime(note.createdAt)}`}</Text>
                <Text size="medium" wordBreak="break-word">
                  {note.text}
                </Text>
              </Box>
            ))}
          </Box>
        ),
      )}
      {group(
        "about",
        "How to read this report",
        report.method === "AI_INTERPRETATION" ? "Analysed with AI" : "Analysed by FlowLens rules",
        <ReadingGuide report={report} />,
      )}
      {group(
        "raw",
        "Raw data",
        "The unchanged TinyFish result, for debugging",
        <Pre tabIndex={0} aria-label="Raw TinyFish result JSON">
          {JSON.stringify(session.rawResult ?? null, null, 2)}
        </Pre>,
      )}
    </Box>
  );
}

/** Legend for the report's ratings, plus the method and its limits. */
function ReadingGuide({ report }: { report: UsabilityReport }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.6">
      <Field label="Who tested">
        <Text size="medium">
          An AI browser agent attempted your task on the live website, guided by your persona. It isn&apos;t a real person, so treat
          issues as leads to confirm with participants, not as verdicts.
        </Text>
      </Field>
      <Field label="Severity">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          {SEVERITY_ORDER.map((s) => (
            <Text key={s} size="small">{`${SEVERITY_VIEW[s].label}: ${SEVERITY_VIEW[s].rule}`}</Text>
          ))}
          <Text size="small" color="surface.text.gray.muted">
            Set by a fixed rule from what the agent ran into. One session can&apos;t show how often real people would hit an issue.
          </Text>
        </Box>
      </Field>
      <Field label="Issue types">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          {(["FUNCTIONAL_FAILURE", "USABILITY_HYPOTHESIS"] as const).map((k) => (
            <Text key={k} size="small">{`${FINDING_KIND_VIEW[k].label}: ${FINDING_KIND_VIEW[k].description}`}</Text>
          ))}
        </Box>
      </Field>
      <Field label="Success criteria">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Text size="small">
            {`${CHECKPOINT_VIEW.PASSED.label}, ${CHECKPOINT_VIEW.FAILED.label.toLowerCase()}, ${CHECKPOINT_VIEW.BLOCKED.label.toLowerCase()} or ${CHECKPOINT_VIEW.NOT_VERIFIED.label.toLowerCase()}: what the agent reported for each criterion.`}
          </Text>
          <Text size="small">
            {`How sure we are that a criterion was met: ${VERIFICATION_VIEW.CONFIRMED.label} (strongest), ${VERIFICATION_VIEW.CONSISTENT.label.toLowerCase()}, ${VERIFICATION_VIEW.AGENT_REPORTED.label.toLowerCase()}, ${VERIFICATION_VIEW.LIMITED.label.toLowerCase()} or ${VERIFICATION_VIEW.CONTRADICTED.label.toLowerCase()}.`}
          </Text>
        </Box>
      </Field>
      <Field label="Links">
        <Text size="small">
          Step, Criterion, Obstacle, Action and Note links open the item they refer to: a step in the journey, a success criterion, or something
          the agent reported.
        </Text>
      </Field>
      <Field label="How this report was made">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Text size="small">{report.methodNote}</Text>
          {report.journey.completenessNote ? (
            <Text size="small" color="surface.text.gray.subtle">
              {report.journey.completenessNote}
            </Text>
          ) : null}
        </Box>
      </Field>
      <Field label="Limits of this test">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          {report.limitations.map((l, i) => (
            <Text key={i} size="small" color="surface.text.gray.subtle">
              {l}
            </Text>
          ))}
        </Box>
      </Field>
    </Box>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      {children}
    </Box>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <Box
      id={`evidence-${item.ref}`}
      display="grid"
      gridTemplateColumns="96px minmax(0, 1fr)"
      gap="spacing.4"
      paddingY="spacing.4"
      borderBottomWidth="thin"
      borderBottomColor="surface.border.gray.muted"
    >
      <Text size="small" weight="semibold" color="surface.text.gray.subtle">
        {refName(item.ref)}
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
        {item.pageUrl ? <PageLink url={item.pageUrl} /> : null}
      </Box>
    </Box>
  );
}
