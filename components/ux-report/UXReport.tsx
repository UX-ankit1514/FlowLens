"use client";

import { useCallback, useMemo, useState } from "react";
import styled from "styled-components";
import {
  Alert,
  AlertTriangleIcon,
  announce,
  ArrowLeftIcon,
  ArrowRightIcon,
  Badge,
  Box,
  Button,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  Heading,
  Link,
  MinusCircleIcon,
  RefreshIcon,
  Spinner,
  Text,
  XCircleIcon,
} from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import { useSession } from "@/lib/client/useSession";
import {
  CHECKPOINT_VIEW,
  TASK_OUTCOME_VIEW,
  VERIFICATION_VIEW,
  formatDateTime,
  sessionStatusView,
  type FeedbackColor,
} from "@/lib/presentation/labels";
import {
  SEVERITY_ORDER,
  SEVERITY_VIEW,
  bySeverity,
  isFrictionStep,
  readableDuration,
  shortUrl,
  type Severity,
} from "@/lib/presentation/report-view";
import type { Checkpoint, CheckpointStatus, HumanValidation, JourneyStep, TestSession, UsabilityReport, UXFinding } from "@/types";
import { SessionLoadFailed, SessionLoading, SessionNotFound } from "@/components/ui/SessionStates";
import { EvidenceRefs, RefLink, RefText } from "./EvidenceRefs";
import { EvidenceSection, evidenceGroupOf } from "./EvidenceSection";
import { FindingCard } from "./FindingCard";
import { JourneyTimeline, STEP_PREVIEW } from "./JourneyTimeline";
import { ReportNavContext, useReportNav } from "./nav";
import { buildSummaryText } from "./summaryText";

export function UXReport({ id }: { id: string }) {
  const { session, loadError, refetch } = useSession(id);

  if (loadError === "not-found") return <SessionNotFound />;
  if (loadError === "network" && !session) return <SessionLoadFailed onRetry={() => void refetch()} />;
  if (!session) return <SessionLoading />;

  if (!session.report || !session.report.journey) {
    const status = sessionStatusView(session);
    return (
      <Box paddingY="spacing.10" display="flex" flexDirection="column" alignItems="center" gap="spacing.4" textAlign="center">
        {status.busy ? <Spinner size="xlarge" accessibilityLabel={status.label} /> : null}
        <Heading as="h1" size="medium">
          {status.busy ? "The report isn't ready yet" : "No report for this session"}
        </Heading>
        <Text color="surface.text.gray.muted">
          {status.busy
            ? `Status: ${status.label}. The report appears here as soon as the run finishes and is analysed.`
            : "This session ended before the agent started, so there's nothing to report."}
        </Text>
        <Button variant="secondary" href={`/sessions/${id}`}>
          {status.busy ? "Watch the session" : "Back to session"}
        </Button>
      </Box>
    );
  }

  return <ReportBody session={session} report={session.report} onChanged={() => void refetch()} />;
}

function ReportBody({ session, report, onChanged }: { session: TestSession; report: UsabilityReport; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [frictionOnly, setFrictionOnly] = useState(false);
  const [highlighted, setHighlighted] = useState<string>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const d = session.definition;
  const stopped = session.executionStatus !== "COMPLETED";
  const validations = useMemo(() => new Map((session.validations ?? []).map((v) => [v.findingId, v])), [session.validations]);
  const ranked = useMemo(() => bySeverity(report.findings, report.checkpoints), [report]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of report.evidence) map.set(e.ref, e.label);
    for (const s of report.journey.steps) map.set(s.ref, s.statedPurpose || s.inferredPurpose || "Step");
    for (const c of report.checkpoints) map.set(c.id, c.description);
    for (const f of report.findings) map.set(f.id, f.title);
    for (const b of report.technicalBlockers) map.set(b.id, b.title);
    return map;
  }, [report]);

  const stepByRef = useMemo(() => new Map(report.journey.steps.map((s) => [s.ref, s])), [report]);
  const stepByEvent = useMemo(
    () => new Map(report.journey.steps.filter((s) => s.eventRef).map((s) => [s.eventRef as string, s])),
    [report],
  );
  const stepOf = useCallback((ref: string): JourneyStep | undefined => stepByRef.get(ref) ?? stepByEvent.get(ref), [stepByEvent, stepByRef]);

  const reveal = useCallback((elementId: string) => {
    // Wait a frame so newly expanded content exists before scrolling to it.
    requestAnimationFrame(() => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
  }, []);

  const go = useCallback(
    (ref: string) => {
      const step = stepOf(ref);
      if (step) {
        const index = report.journey.steps.findIndex((s) => s.ref === step.ref);
        if (frictionOnly && !isFrictionStep(step)) setFrictionOnly(false);
        if (index >= STEP_PREVIEW) setShowAll(true);
        setExpanded((prev) => new Set(prev).add(step.ref));
        setHighlighted(step.ref);
        reveal(`step-${step.ref}`);
        return;
      }
      if (/^C\d+$/.test(ref)) return reveal(`criterion-${ref}`);
      if (/^F\d+$/.test(ref)) return reveal(`finding-${ref}`);
      if (/^T\d+$/.test(ref)) return reveal(`blocker-${ref}`);
      const group = evidenceGroupOf(ref);
      if (group) {
        setOpenGroups((prev) => new Set(prev).add(group));
        reveal(`evidence-${ref}`);
      }
    },
    [frictionOnly, report, reveal, stepOf],
  );

  const nav = useMemo(
    () => ({ go, labelOf: (ref: string) => labels.get(ref), known: (ref: string) => labels.has(ref), stepOf, sessionId: session.id }),
    [go, labels, session.id, stepOf],
  );

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummaryText(session, report));
      setCopied(true);
      announce("Report summary copied to clipboard");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      announce("Copy failed. Your browser blocked clipboard access.");
    }
  }

  const steps = report.journey.steps.filter((s) => !s.terminal);

  return (
    <ReportNavContext.Provider value={nav}>
      <Box display="flex" flexDirection="column" gap="spacing.11">
        {/* Header */}
        <Box as="header" display="flex" flexDirection="column" gap="spacing.5">
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="spacing.4">
            <Link href={`/sessions/${session.id}`} icon={ArrowLeftIcon} size="small">
              Back to session
            </Link>
            <Box display="flex" gap="spacing.3" flexWrap="wrap">
              <Button variant="secondary" size="small" icon={copied ? CheckIcon : CopyIcon} onClick={copySummary}>
                {copied ? "Copied" : "Copy summary"}
              </Button>
              <Button variant="secondary" size="small" icon={RefreshIcon} href={`/new?from=${session.id}`}>
                Run another test
              </Button>
            </Box>
          </Box>
          <Box display="flex" flexDirection="column" gap="spacing.3">
            <Text size="small" weight="semibold" color="surface.text.gray.muted">
              Usability test report
            </Text>
            <Heading as="h1" size="large" wordBreak="break-word">
              {d.sessionName || (d.goal.length > 110 ? `${d.goal.slice(0, 109).trimEnd()}…` : d.goal)}
            </Heading>
            <Text size="small" color="surface.text.gray.muted">
              {[
                shortUrl(d.websiteUrl),
                formatDateTime(session.startedAt ?? session.createdAt),
                report.journey.durationMs !== undefined
                  ? `${steps.length} ${steps.length === 1 ? "step" : "steps"} in ${readableDuration(report.journey.durationMs)}`
                  : undefined,
                report.method === "AI_INTERPRETATION" ? "Analysed with AI" : "Analysed by FlowLens rules (no AI)",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Box>
        </Box>

        {/* 1 — Executive summary */}
        <Box display="flex" flexDirection="column" gap="spacing.5">
          <Summary session={session} report={report} ranked={ranked} validations={validations} />
          {report.aiUnavailableReason ? (
            <Alert
              color="notice"
              isFullWidth
              isDismissible={false}
              title="AI analysis wasn't available"
              description={`This report uses FlowLens's fixed rules only, because ${report.aiUnavailableReason}.`}
            />
          ) : null}
          {stopped && session.error && session.error.message !== report.outcomeRationale ? (
            <Alert color="negative" isFullWidth isDismissible={false} title="The run failed" description={session.error.message} />
          ) : null}
        </Box>

        {/* 2 — Issues, most severe first */}
        <Section
          id="findings"
          title="Issues to fix"
          count={stopped ? undefined : report.findings.length}
          note={
            stopped
              ? undefined
              : "Most severe first. Severity is set from what the agent ran into: High kept a success criterion from being met, Medium broke or slowed the task, Low is worth a look. One session can't show how often real people would hit an issue."
          }
        >
          {stopped ? (
            <Empty>
              This session didn&apos;t finish, so no issues were analysed. A failed or stopped run isn&apos;t evidence of a usability problem.
            </Empty>
          ) : report.findings.length === 0 ? (
            <Empty>
              No usability issues were found. The agent reported no obstacles other than technical ones. That doesn&apos;t prove the journey is
              problem-free; it means nothing was seen in this session.
            </Empty>
          ) : (
            <Box display="flex" flexDirection="column" gap="spacing.8">
              {SEVERITY_ORDER.map((level) => {
                const group = ranked.filter((r) => r.severity === level);
                if (group.length === 0) return null;
                return (
                  <Box key={level} display="flex" flexDirection="column" gap="spacing.4">
                    <Box display="flex" alignItems="center" gap="spacing.3">
                      <SeverityDot severity={level} />
                      <Text weight="semibold">{`${SEVERITY_VIEW[level].label} · ${group.length}`}</Text>
                      <Text size="small" color="surface.text.gray.muted">
                        {SEVERITY_VIEW[level].rule}
                      </Text>
                    </Box>
                    {group.map(({ finding, severity }) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        severity={severity}
                        validation={validations.get(finding.id)}
                        onValidationChanged={onChanged}
                      />
                    ))}
                  </Box>
                );
              })}
            </Box>
          )}
        </Section>

        {/* 3 — Success criteria */}
        <Section
          id="criteria"
          title="Success criteria"
          note="Your criteria, with what the agent reported for each, and how far the recorded evidence backs it up."
        >
          <CriteriaList checkpoints={report.checkpoints} />
        </Section>

        {/* 4 — Journey */}
        <Section
          id="journey"
          title="How the journey went"
          note="Every step the agent took, in order. The strip shows where it struggled; select a step to see its screenshot and what the agent was trying to do."
        >
          <JourneyTimeline
            sessionId={session.id}
            journey={report.journey}
            state={{
              expanded,
              toggle: (ref) =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(ref)) next.delete(ref);
                  else next.add(ref);
                  return next;
                }),
              showAll,
              setShowAll,
              frictionOnly,
              setFrictionOnly,
              highlighted,
            }}
          />
        </Section>

        {/* 5 — Test-setup issues */}
        <Section
          id="blockers"
          title="Test-setup issues"
          count={report.technicalBlockers.length}
          note="Problems with the automated test itself, such as bot protection or network trouble. They say nothing about your design, so they're kept out of the issues above."
        >
          {report.technicalBlockers.length === 0 ? (
            <Empty>None. The test environment didn&apos;t get in the agent&apos;s way.</Empty>
          ) : (
            <Box display="flex" flexDirection="column" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
              {report.technicalBlockers.map((b, i) => (
                <Box
                  key={b.id}
                  id={`blocker-${b.id}`}
                  padding="spacing.6"
                  display="flex"
                  flexDirection="column"
                  gap="spacing.3"
                  borderTopWidth={i === 0 ? undefined : "thin"}
                  borderTopColor="surface.border.gray.muted"
                >
                  <Box display="flex" gap="spacing.3" alignItems="center" flexWrap="wrap">
                    <Text weight="semibold">{b.title}</Text>
                    {b.stoppedRun ? (
                      <Badge color="negative" emphasis="subtle" size="small">
                        Stopped the test
                      </Badge>
                    ) : null}
                  </Box>
                  <RefText size="small">{b.effect}</RefText>
                  <Box display="flex" flexDirection="column" gap="spacing.1">
                    <Text size="xsmall" color="surface.text.gray.muted">
                      The agent reported
                    </Text>
                    <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">{`“${b.description}”`}</Text>
                  </Box>
                  <EvidenceRefs refs={[...b.stepRefs, ...b.evidenceRefs]} empty="No linked steps" max={6} />
                </Box>
              ))}
            </Box>
          )}
        </Section>

        {/* 6 — Evidence and method */}
        <Section id="evidence" title="Evidence and details" note="Everything this report is based on. Links elsewhere in the report open the matching item here.">
          <EvidenceSection
            session={session}
            report={report}
            open={openGroups}
            setOpen={(id, isOpen) =>
              setOpenGroups((prev) => {
                if (prev.has(id) === isOpen) return prev;
                const next = new Set(prev);
                if (isOpen) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        </Section>

        <Box display="flex" gap="spacing.3" flexWrap="wrap" paddingBottom="spacing.8">
          <Button href={`/new?from=${session.id}`} icon={RefreshIcon}>
            Run another test
          </Button>
          <Button variant="secondary" href="/new">
            Start a new test
          </Button>
        </Box>
      </Box>
    </ReportNavContext.Provider>
  );
}

/* ------------------------------------------------------------------------ */
/* Executive summary                                                         */
/* ------------------------------------------------------------------------ */

function Summary({
  session,
  report,
  ranked,
  validations,
}: {
  session: TestSession;
  report: UsabilityReport;
  ranked: Array<{ finding: UXFinding; severity: Severity }>;
  validations: Map<string, HumanValidation>;
}) {
  const { go } = useReportNav();
  const outcome = TASK_OUTCOME_VIEW[report.taskOutcome];
  const stopped = session.executionStatus !== "COMPLETED";
  const met = report.checkpoints.filter((c) => c.status === "PASSED");
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, ranked.filter((r) => r.severity === s).length])) as Record<Severity, number>;
  const checked = report.findings.filter((f) => (validations.get(f.id)?.status ?? "NOT_TESTED") !== "NOT_TESTED").length;
  const steps = report.journey.steps.filter((s) => !s.terminal);
  const friction = steps.filter(isFrictionStep).length;
  // The count is already shown beside the outcome; keep only what the rationale adds to it.
  const rationale = report.outcomeRationale.replace(/^\d+ of \d+ success criteria (?:were|was) reported as met\.\s*/, "").trim();

  return (
    <Box
      as="section"
      aria-label="Summary"
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="large"
      overflow="hidden"
    >
      <Box padding={{ base: "spacing.6", m: "spacing.8" }} display="flex" flexDirection="column" gap="spacing.7">
        {/* Outcome */}
        <Box display="flex" flexDirection="column" gap="spacing.4">
          <Box display="flex" alignItems="center" gap="spacing.3" flexWrap="wrap">
            <Text as="span" size="small" weight="semibold" color="surface.text.gray.muted">
              Did the agent complete the task?
            </Text>
          </Box>
          <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
            <Badge color={outcome.color} emphasis="intense" size="large">
              {outcome.label}
            </Badge>
            {report.checkpoints.length > 0 ? (
              <Text weight="semibold">{`${met.length} of ${report.checkpoints.length} success criteria met`}</Text>
            ) : null}
          </Box>
          {report.checkpoints.length > 0 ? <CriteriaMeter checkpoints={report.checkpoints} /> : null}
          {rationale ? (
            <RefText size="large" weight="semibold">
              {rationale}
            </RefText>
          ) : null}
          <RefText color="surface.text.gray.subtle">{report.summary}</RefText>
        </Box>

        {/* Top issues · What worked */}
        <Box display="grid" gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "repeat(2, minmax(0, 1fr))" }} gap="spacing.5">
          <Box backgroundColor="surface.background.gray.moderate" borderRadius="medium" padding="spacing.5" display="flex" flexDirection="column" gap="spacing.4">
            <Text weight="semibold">Top issues</Text>
            {stopped ? (
              <Text size="small" color="surface.text.gray.muted">
                Not analysed: the run didn&apos;t finish.
              </Text>
            ) : ranked.length === 0 ? (
              <Text size="small" color="surface.text.gray.muted">
                No usability issues were found in this session.
              </Text>
            ) : (
              <PlainList>
                {ranked.slice(0, 3).map(({ finding, severity }) => (
                  <li key={finding.id}>
                    <Box paddingTop="spacing.2" flexShrink={0}>
                      <SeverityDot severity={severity} />
                    </Box>
                    <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
                      <IssueLink type="button" onClick={() => go(finding.id)}>
                        <Text as="span" size="medium" weight="medium" color="interactive.text.primary.normal" wordBreak="break-word">
                          {finding.title}
                        </Text>
                      </IssueLink>
                      <Text size="xsmall" color="surface.text.gray.muted">
                        {SEVERITY_VIEW[severity].label}
                      </Text>
                    </Box>
                  </li>
                ))}
              </PlainList>
            )}
            {!stopped && ranked.length > 3 ? (
              <Text size="small" color="surface.text.gray.muted">{`+${ranked.length - 3} more below`}</Text>
            ) : null}
          </Box>

          <Box backgroundColor="surface.background.gray.moderate" borderRadius="medium" padding="spacing.5" display="flex" flexDirection="column" gap="spacing.4">
            <Text weight="semibold">What worked</Text>
            {met.length === 0 ? (
              <Text size="small" color="surface.text.gray.muted">
                {report.checkpoints.length === 0 ? "No success criteria were reported on." : "None of the success criteria were met in this session."}
              </Text>
            ) : (
              <PlainList>
                {met.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <Box paddingTop="spacing.1" flexShrink={0}>
                      <CheckCircleIcon size="medium" color="feedback.icon.positive.intense" />
                    </Box>
                    <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
                      <Text size="medium" wordBreak="break-word">
                        {c.description}
                      </Text>
                      <Text size="xsmall" color="surface.text.gray.muted">
                        {VERIFICATION_VIEW[c.verification].label || "Met"}
                      </Text>
                    </Box>
                  </li>
                ))}
              </PlainList>
            )}
            {met.length > 3 ? <Text size="small" color="surface.text.gray.muted">{`+${met.length - 3} more below`}</Text> : null}
          </Box>
        </Box>

        {/* Next step */}
        <Box backgroundColor="surface.background.primary.faint" borderRadius="medium" padding="spacing.5" display="flex" gap="spacing.4" alignItems="flex-start">
          <Box flexShrink={0} paddingTop="spacing.1">
            <ArrowRightIcon size="medium" color="interactive.icon.primary.normal" />
          </Box>
          <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
            <Text size="small" weight="semibold" color="interactive.text.primary.normal">
              Recommended next step
            </Text>
            <RefText weight="medium">{report.nextAction}</RefText>
          </Box>
        </Box>

        {/* At a glance */}
        <Box display="grid" gridTemplateColumns={{ base: "repeat(2, minmax(0, 1fr))", l: "repeat(4, minmax(0, 1fr))" }} gap="spacing.4">
          <Stat
            href="#findings"
            label="Issues"
            value={stopped ? "—" : String(report.findings.length)}
            detail={stopped ? "Not analysed" : report.findings.length === 0 ? "None found" : `${counts.HIGH} high · ${counts.MEDIUM} medium · ${counts.LOW} low`}
          />
          <Stat
            href="#journey"
            label="Journey"
            value={`${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
            detail={`${report.journey.durationMs !== undefined ? `${readableDuration(report.journey.durationMs)} · ` : ""}${friction} with friction`}
          />
          <Stat
            href="#blockers"
            label="Test-setup issues"
            value={String(report.technicalBlockers.length)}
            detail={report.technicalBlockers.length ? "Not counted as design issues" : "None"}
          />
          <Stat
            href="#findings"
            label="Checked with real users"
            value={report.findings.length === 0 ? "—" : `${checked} of ${report.findings.length}`}
            detail={checked === 0 ? "Mark each issue after testing" : "Issues checked with participants"}
          />
        </Box>
      </Box>

      <Box
        backgroundColor="surface.background.gray.moderate"
        borderTopWidth="thin"
        borderTopColor="surface.border.gray.muted"
        paddingX={{ base: "spacing.6", m: "spacing.8" }}
        paddingY="spacing.4"
      >
        <Text size="small" color="surface.text.gray.muted">
          Tested by an AI agent using your persona, not by real people. Treat these issues as strong leads to confirm with participants, not as
          final verdicts.
        </Text>
      </Box>
    </Box>
  );
}

const STATUS_FILL: Record<CheckpointStatus, "feedback.background.positive.intense" | "feedback.background.negative.intense" | "feedback.background.notice.intense" | "surface.background.gray.subtle"> = {
  PASSED: "feedback.background.positive.intense",
  FAILED: "feedback.background.negative.intense",
  BLOCKED: "feedback.background.notice.intense",
  NOT_VERIFIED: "surface.background.gray.subtle",
};

const PlainList = styled.ul(
  ({ theme }: { theme: Theme }) => `
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[4]}px;
  > li { display: flex; gap: ${theme.spacing[3]}px; align-items: flex-start; min-width: 0; }
`,
);

/** A wrapping text button: long issue titles must wrap, which Blade's Link doesn't. */
const IssueLink = styled.button(
  ({ theme }: { theme: Theme }) => `
  all: unset;
  cursor: pointer;
  text-align: left;
  border-radius: ${theme.border.radius.small}px;
  @media (hover: hover) and (pointer: fine) {
    &:hover span { text-decoration: underline; text-underline-offset: 3px; }
  }
  &:focus-visible { outline: 2px solid ${theme.colors.interactive.border.primary.default}; outline-offset: 2px; }
`,
);

const MeterRow = styled.div(
  ({ theme }: { theme: Theme }) => `
  display: flex;
  gap: ${theme.spacing[2]}px;
`,
);

/** One segment per success criterion, coloured by its result, with a legend for the results present. */
function CriteriaMeter({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const present = (["PASSED", "FAILED", "BLOCKED", "NOT_VERIFIED"] as const).filter((st) => checkpoints.some((c) => c.status === st));
  return (
    <Box display="flex" flexDirection="column" gap="spacing.3">
      <CriteriaBar checkpoints={checkpoints} />
      <Box display="flex" columnGap="spacing.5" rowGap="spacing.2" flexWrap="wrap">
        {present.map((st) => (
          <Box key={st} display="flex" gap="spacing.2" alignItems="center">
            <Box
              width="10px"
              height="10px"
              borderRadius="small"
              backgroundColor={STATUS_FILL[st]}
              borderWidth={st === "NOT_VERIFIED" ? "thin" : undefined}
              borderColor="surface.border.gray.normal"
            />
            <Text size="xsmall" color="surface.text.gray.subtle">
              {`${CHECKPOINT_VIEW[st].label} · ${checkpoints.filter((c) => c.status === st).length}`}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function CriteriaBar({ checkpoints }: { checkpoints: Checkpoint[] }) {
  return (
    <MeterRow role="img" aria-label={checkpoints.map((c) => `${c.description}: ${CHECKPOINT_VIEW[c.status].label}`).join("; ")}>
      {checkpoints.map((c) => (
        <Box
          key={c.id}
          flex="1"
          height="8px"
          borderRadius="small"
          backgroundColor={STATUS_FILL[c.status]}
          borderWidth={c.status === "NOT_VERIFIED" ? "thin" : undefined}
          borderColor="surface.border.gray.muted"
        />
      ))}
    </MeterRow>
  );
}

function Stat({ label, value, detail, href }: { label: string; value: string; detail: string; href: string }) {
  return (
    <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" padding="spacing.5" display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
      <Link href={href} size="small" color="neutral">
        {label}
      </Link>
      <Text size="large" weight="semibold">
        {value}
      </Text>
      <Text size="small" color="surface.text.gray.muted">
        {detail}
      </Text>
    </Box>
  );
}

const DOT_FILL: Record<Severity, "feedback.background.negative.intense" | "feedback.background.notice.intense" | "surface.background.gray.subtle"> = {
  HIGH: "feedback.background.negative.intense",
  MEDIUM: "feedback.background.notice.intense",
  LOW: "surface.background.gray.subtle",
};

function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <Box
      width="10px"
      height="10px"
      borderRadius="round"
      backgroundColor={DOT_FILL[severity]}
      borderWidth={severity === "LOW" ? "thin" : undefined}
      borderColor="surface.border.gray.normal"
      flexShrink={0}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Success criteria                                                          */
/* ------------------------------------------------------------------------ */

const STATUS_ICON: Record<CheckpointStatus, { Icon: typeof CheckCircleIcon; color: "feedback.icon.positive.intense" | "feedback.icon.negative.intense" | "feedback.icon.notice.intense" | "surface.icon.gray.muted" }> = {
  PASSED: { Icon: CheckCircleIcon, color: "feedback.icon.positive.intense" },
  FAILED: { Icon: XCircleIcon, color: "feedback.icon.negative.intense" },
  BLOCKED: { Icon: AlertTriangleIcon, color: "feedback.icon.notice.intense" },
  NOT_VERIFIED: { Icon: MinusCircleIcon, color: "surface.icon.gray.muted" },
};

function CriteriaList({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) return <Empty>No success criteria were set for this test.</Empty>;
  return (
    <Box display="flex" flexDirection="column" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
      {checkpoints.map((c, i) => {
        const status = CHECKPOINT_VIEW[c.status];
        const verification = VERIFICATION_VIEW[c.verification];
        const { Icon, color } = STATUS_ICON[c.status];
        const proof = c.verificationRefs.filter((r) => r !== c.id);
        return (
          <Box
            key={c.id}
            id={`criterion-${c.id}`}
            display="grid"
            gridTemplateColumns="24px minmax(0, 1fr)"
            gap="spacing.4"
            padding="spacing.5"
            borderTopWidth={i === 0 ? undefined : "thin"}
            borderTopColor="surface.border.gray.muted"
            alignItems="start"
          >
            <Box paddingTop="spacing.1">
              <Icon size="medium" color={color} />
            </Box>
            <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
              <Box display="flex" justifyContent="space-between" gap="spacing.4" flexWrap="wrap" alignItems="baseline">
                <Text size="medium" weight="semibold" wordBreak="break-word">
                  {c.description}
                </Text>
                <Box display="flex" gap="spacing.2" alignItems="center" flexShrink={0}>
                  <Badge color={status.color as FeedbackColor} emphasis="subtle" size="small">
                    {status.label}
                  </Badge>
                  {verification.label ? (
                    <Badge color={verification.color as FeedbackColor} emphasis="subtle" size="small">
                      {verification.label}
                    </Badge>
                  ) : null}
                </Box>
              </Box>
              {c.observation ? (
                <Box display="flex" flexDirection="column" gap="spacing.1">
                  <Text size="xsmall" color="surface.text.gray.muted">
                    What the agent reported
                  </Text>
                  <RefText size="small" color="surface.text.gray.subtle">
                    {c.observation}
                  </RefText>
                </Box>
              ) : null}
              {c.status === "PASSED" && c.verificationNote ? (
                <Box display="flex" flexDirection="column" gap="spacing.1">
                  <Text size="xsmall" color="surface.text.gray.muted">
                    How sure we are
                  </Text>
                  <RefText size="small" color="surface.text.gray.subtle">
                    {c.verificationNote}
                  </RefText>
                </Box>
              ) : null}
              {proof.length ? (
                <Box display="flex" gap="spacing.3" alignItems="center" flexWrap="wrap">
                  <Text size="xsmall" color="surface.text.gray.muted">
                    Evidence
                  </Text>
                  {proof.slice(0, 4).map((r) => (
                    <RefLink key={r} refId={r} />
                  ))}
                </Box>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/* ------------------------------------------------------------------------ */
/* Layout helpers                                                            */
/* ------------------------------------------------------------------------ */

function Section({
  id,
  title,
  note,
  count,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Box as="section" id={id} display="flex" flexDirection="column" gap="spacing.6">
      <Box display="flex" flexDirection="column" gap="spacing.2" maxWidth="760px">
        <Box display="flex" alignItems="baseline" gap="spacing.3">
          <Heading as="h2" size="large">
            {title}
          </Heading>
          {count !== undefined ? (
            <Text size="large" color="surface.text.gray.muted">
              {count}
            </Text>
          ) : null}
        </Box>
        {note ? (
          <Text size="medium" color="surface.text.gray.muted">
            {note}
          </Text>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Box padding="spacing.6" borderRadius="medium" borderWidth="thin" borderColor="surface.border.gray.muted">
      <Text color="surface.text.gray.muted">{children}</Text>
    </Box>
  );
}
