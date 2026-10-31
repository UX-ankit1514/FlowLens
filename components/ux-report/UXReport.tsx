"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  announce,
  ArrowLeftIcon,
  ArrowRightIcon,
  Badge,
  Box,
  Button,
  CheckIcon,
  CopyIcon,
  Heading,
  Link,
  RefreshIcon,
  SegmentedControl,
  SegmentedControlItem,
  Spinner,
  Text,
  TextInput,
} from "@razorpay/blade/components";
import { useSession } from "@/lib/client/useSession";
import {
  CHECKPOINT_VIEW,
  TASK_OUTCOME_VIEW,
  VALIDATION_VIEW,
  VERIFICATION_VIEW,
  displayUrl,
  formatDateTime,
  formatElapsed,
  sessionStatusView,
} from "@/lib/presentation/labels";
import type { HumanValidationStatus, TestSession, UsabilityReport } from "@/types";
import { SessionLoadFailed, SessionLoading, SessionNotFound } from "@/components/ui/SessionStates";
import { EvidenceRefs } from "./EvidenceRefs";
import { EvidenceSection, evidenceGroupOf } from "./EvidenceSection";
import { FindingCard } from "./FindingCard";
import { JourneyTimeline, STEP_PREVIEW } from "./JourneyTimeline";
import { ReportNavContext } from "./nav";
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
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [highlighted, setHighlighted] = useState<string>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const d = session.definition;
  const stopped = session.executionStatus !== "COMPLETED";
  const validations = new Map((session.validations ?? []).map((v) => [v.findingId, v]));
  const validationOf = (findingId: string): HumanValidationStatus => validations.get(findingId)?.status ?? "NOT_TESTED";

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of report.evidence) map.set(e.ref, e.label);
    for (const s of report.journey.steps) map.set(s.ref, s.statedPurpose || s.inferredPurpose || "Step");
    for (const c of report.checkpoints) map.set(c.id, c.description);
    for (const f of report.findings) map.set(f.id, f.title);
    for (const b of report.technicalBlockers) map.set(b.id, b.title);
    return map;
  }, [report]);

  const stepRefs = useMemo(() => new Set(report.journey.steps.map((s) => s.ref)), [report]);
  const stepByEvent = useMemo(
    () => new Map(report.journey.steps.filter((s) => s.eventRef).map((s) => [s.eventRef as string, s.ref])),
    [report],
  );

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
      const step = stepRefs.has(ref) ? ref : stepByEvent.get(ref);
      if (step) {
        setFlaggedOnly(false);
        const index = report.journey.steps.findIndex((s) => s.ref === step);
        if (index >= STEP_PREVIEW) setShowAll(true);
        setExpanded((prev) => new Set(prev).add(step));
        setHighlighted(step);
        reveal(`step-${step}`);
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
    [report, reveal, stepByEvent, stepRefs],
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

  return (
    <ReportNavContext.Provider value={{ go, labelOf: (ref) => labels.get(ref) }}>
      <Box display="flex" flexDirection="column" gap="spacing.10">
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
              <Button variant="secondary" size="small" icon={RefreshIcon} href={`/?from=${session.id}`}>
                Run another test
              </Button>
            </Box>
          </Box>
          <Box display="flex" flexDirection="column" gap="spacing.2">
            <Heading as="h1" size="large" wordBreak="break-word">
              {d.sessionName || (d.goal.length > 110 ? `${d.goal.slice(0, 109).trimEnd()}…` : d.goal)}
            </Heading>
            <Text size="small" color="surface.text.gray.muted">
              {[
                displayUrl(d.websiteUrl),
                formatDateTime(session.startedAt ?? session.createdAt),
                report.journey.durationMs !== undefined ? `${formatElapsed(report.journey.durationMs)} run` : undefined,
                report.method === "AI_INTERPRETATION" ? "AI interpretation" : "Evidence summary (rule-based)",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Box>
        </Box>

        {/* 1 — Summary verdict */}
        <Verdict session={session} report={report} validationOf={validationOf} />

        {report.aiUnavailableReason ? (
          <Alert
            color="notice"
            isFullWidth
            isDismissible={false}
            title="AI interpretation wasn't available"
            description={`This report uses rule-based analysis only, because ${report.aiUnavailableReason}.`}
          />
        ) : null}
        {stopped && session.error ? (
          <Alert color="negative" isFullWidth isDismissible={false} title="The run failed" description={session.error.message} />
        ) : null}

        {/* 2 — Journey timeline */}
        <Section
          id="journey"
          title="Journey timeline"
          aside={
            <Badge color={report.journey.completeness === "STEP_LEVEL" ? "neutral" : "notice"} emphasis="subtle">
              {report.journey.completeness === "STEP_LEVEL"
                ? report.journey.endedEarly
                  ? "Step-level trace · ended early"
                  : "Step-level trace"
                : report.journey.completeness === "PROGRESS_ONLY"
                  ? "Incomplete trace"
                  : "No trace"}
            </Badge>
          }
          note={report.journey.completenessNote}
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
              flaggedOnly,
              setFlaggedOnly,
              highlighted,
            }}
          />
        </Section>

        {/* 3 — UX findings & recommendations */}
        <Section
          id="findings"
          title="UX findings & recommendations"
          note={
            stopped
              ? undefined
              : "Each finding says what happened, where, why it may matter for this persona, and what to investigate. Functional failures are things that didn't work; hypotheses need checking."
          }
        >
          {stopped ? (
            <Text color="surface.text.gray.muted">
              This session didn&apos;t finish, so no findings were produced. A failed or stopped run isn&apos;t evidence of a usability problem.
            </Text>
          ) : report.findings.length === 0 ? (
            <Text color="surface.text.gray.muted">
              No usability findings. The agent reported no obstacles other than technical ones. That isn&apos;t proof the journey is
              problem-free; nothing was observed in this session.
            </Text>
          ) : (
            <Box display="flex" flexDirection="column" gap="spacing.5">
              {report.findings.map((f) => (
                <FindingCard key={f.id} finding={f} validation={validationOf(f.id)} />
              ))}
            </Box>
          )}
        </Section>

        {/* 4 — Technical blockers */}
        <Section
          id="blockers"
          title="Technical blockers"
          note="Bot protection, proxies, network errors and run failures describe the automated test environment. They're never counted as usability findings, and FlowLens doesn't recommend design changes because of them."
        >
          {report.technicalBlockers.length === 0 ? (
            <Text color="surface.text.gray.muted">No technical blockers were recorded in this session.</Text>
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
                        Stopped the run
                      </Badge>
                    ) : null}
                    <Text size="small" color="surface.text.gray.muted">
                      {b.id}
                    </Text>
                  </Box>
                  <Text size="medium" color="surface.text.gray.subtle" wordBreak="break-word">{`“${b.description}”`}</Text>
                  <Text size="small" wordBreak="break-word">
                    {b.effect}
                  </Text>
                  <EvidenceRefs refs={[...b.stepRefs, ...b.evidenceRefs, ...b.affectsCriteria]} />
                </Box>
              ))}
            </Box>
          )}
        </Section>

        {/* 5 — Human validation */}
        <Section
          id="validation"
          title="Human validation"
          note="Whether each finding has been seen with real research participants. FlowLens can't know this unless you record it, so every finding starts as Not tested."
        >
          <HumanValidationList session={session} report={report} validationOf={validationOf} onChanged={onChanged} />
        </Section>

        {/* 6 — Supporting evidence */}
        <Section id="evidence" title="Supporting evidence" note="Everything this report is based on. Evidence links above open the matching item.">
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
          <Button href={`/?from=${session.id}`} icon={RefreshIcon}>
            Run another test
          </Button>
          <Button variant="secondary" href="/">
            Start a new test
          </Button>
        </Box>
      </Box>
    </ReportNavContext.Provider>
  );
}

function Verdict({
  session,
  report,
  validationOf,
}: {
  session: TestSession;
  report: UsabilityReport;
  validationOf: (id: string) => HumanValidationStatus;
}) {
  const outcome = TASK_OUTCOME_VIEW[report.taskOutcome];
  const failures = report.findings.filter((f) => f.kind === "FUNCTIONAL_FAILURE").length;
  const hypotheses = report.findings.length - failures;
  const checked = report.findings.filter((f) => validationOf(f.id) !== "NOT_TESTED").length;
  const stopped = session.executionStatus !== "COMPLETED";

  return (
    <Box
      as="section"
      aria-label="Summary verdict"
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      padding={{ base: "spacing.6", m: "spacing.8" }}
      display="flex"
      flexDirection="column"
      gap="spacing.6"
    >
      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
          <Badge color={outcome.color} emphasis="intense" size="large">
            {outcome.label}
          </Badge>
          <Text size="small" color="surface.text.gray.muted">
            {outcome.description}
          </Text>
        </Box>
        <Text size="large" weight="semibold">
          {report.outcomeRationale}
        </Text>
        <Text size="medium" color="surface.text.gray.subtle">
          {report.summary}
        </Text>
      </Box>

      <Box
        backgroundColor="surface.background.primary.faint"
        borderRadius="medium"
        padding="spacing.5"
        display="flex"
        gap="spacing.4"
        alignItems="flex-start"
      >
        <Box flexShrink={0} paddingTop="spacing.1">
          <ArrowRightIcon size="medium" color="interactive.icon.primary.normal" />
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing.1">
          <Text size="small" weight="semibold" color="interactive.text.primary.normal">
            Most important next action
          </Text>
          <Text size="medium" weight="medium" wordBreak="break-word">
            {report.nextAction}
          </Text>
        </Box>
      </Box>

      <Box display="grid" gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "repeat(3, minmax(0, 1fr))" }} gap="spacing.4">
        <Stat
          href="#findings"
          label="UX findings"
          value={stopped ? "—" : String(report.findings.length)}
          detail={
            stopped
              ? "Not analysed — run didn't finish"
              : report.findings.length === 0
                ? "None observed"
                : `${failures} functional ${failures === 1 ? "failure" : "failures"} · ${hypotheses} ${hypotheses === 1 ? "hypothesis" : "hypotheses"}`
          }
        />
        <Stat
          href="#blockers"
          label="Technical testing blockers"
          value={String(report.technicalBlockers.length)}
          detail={report.technicalBlockers.length ? "Not counted as UX issues" : "None recorded"}
        />
        <Stat
          href="#validation"
          label="Human validation"
          value={checked === 0 ? "Not tested" : `${checked} of ${report.findings.length}`}
          detail={checked === 0 ? "No comparison with real participants" : "Findings checked with participants"}
        />
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Text size="small" weight="semibold" color="surface.text.gray.muted">
          Success criteria — reported by the agent, checked against the evidence
        </Text>
        <Box display="flex" flexDirection="column">
          {report.checkpoints.map((c) => {
            const status = CHECKPOINT_VIEW[c.status];
            const verification = VERIFICATION_VIEW[c.verification];
            return (
              <Box
                key={c.id}
                id={`criterion-${c.id}`}
                display="grid"
                gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "96px minmax(0, 1fr) auto" }}
                gap={{ base: "spacing.2", m: "spacing.5" }}
                paddingY="spacing.4"
                borderTopWidth="thin"
                borderTopColor="surface.border.gray.muted"
                alignItems="start"
              >
                <Box>
                  <Badge color={status.color} emphasis="subtle" size="small">
                    {status.label}
                  </Badge>
                </Box>
                <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
                  <Text size="medium" wordBreak="break-word">{`${c.id} · ${c.description}`}</Text>
                  {c.verificationNote ? (
                    <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">
                      {c.verificationNote}
                    </Text>
                  ) : c.observation ? (
                    <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word" truncateAfterLines={2}>
                      {`Agent: ${c.observation}`}
                    </Text>
                  ) : null}
                </Box>
                <Box display="flex" flexDirection="column" gap="spacing.2" alignItems={{ base: "flex-start", m: "flex-end" }}>
                  {verification.label ? (
                    <Badge color={verification.color} emphasis="subtle" size="small">
                      {verification.label}
                    </Badge>
                  ) : null}
                  {c.verificationRefs.some((r) => r !== c.id) ? (
                    <EvidenceRefs refs={c.verificationRefs.filter((r) => r !== c.id)} max={3} />
                  ) : null}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function Stat({ label, value, detail, href }: { label: string; value: string; detail: string; href: string }) {
  return (
    <Box backgroundColor="surface.background.gray.moderate" borderRadius="medium" padding="spacing.5" display="flex" flexDirection="column" gap="spacing.1">
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

function HumanValidationList({
  session,
  report,
  validationOf,
  onChanged,
}: {
  session: TestSession;
  report: UsabilityReport;
  validationOf: (id: string) => HumanValidationStatus;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries((session.validations ?? []).map((v) => [v.findingId, v.note ?? ""])),
  );
  const [saving, setSaving] = useState<string>();
  const [message, setMessage] = useState<Record<string, string>>({});

  async function save(findingId: string, status: HumanValidationStatus) {
    setSaving(findingId);
    try {
      const res = await fetch(`/api/sessions/${session.id}/validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, status, note: notes[findingId] || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage((m) => ({ ...m, [findingId]: res.ok ? "Saved" : (body.error ?? "Couldn't save.") }));
      if (res.ok) {
        announce(`${findingId} marked ${VALIDATION_VIEW[status].label}`);
        onChanged();
      }
    } catch {
      setMessage((m) => ({ ...m, [findingId]: "Couldn't save. Check your connection." }));
    } finally {
      setSaving(undefined);
    }
  }

  if (report.findings.length === 0) {
    return (
      <Box display="flex" gap="spacing.3" alignItems="center">
        <Badge color="neutral" emphasis="subtle">
          Not tested
        </Badge>
        <Text size="small" color="surface.text.gray.muted">
          There are no findings to compare with participant research.
        </Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
      {report.findings.map((f, i) => {
        const status = validationOf(f.id);
        return (
          <Box
            key={f.id}
            display="grid"
            gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "minmax(0, 1fr) auto" }}
            gap="spacing.4"
            padding="spacing.5"
            alignItems="center"
            borderTopWidth={i === 0 ? undefined : "thin"}
            borderTopColor="surface.border.gray.muted"
          >
            <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
              <Text size="medium" weight="semibold" wordBreak="break-word">{`${f.id} · ${f.title}`}</Text>
              <Box maxWidth="420px">
                <TextInput
                  label="Participant evidence (optional)"
                  labelPosition="top"
                  size="medium"
                  placeholder="e.g. 3 of 5 participants missed the fare"
                  value={notes[f.id] ?? ""}
                  onChange={({ value }) => setNotes((n) => ({ ...n, [f.id]: value ?? "" }))}
                  onBlur={() => {
                    const saved = (session.validations ?? []).find((v) => v.findingId === f.id)?.note ?? "";
                    if ((notes[f.id] ?? "") !== saved) void save(f.id, status);
                  }}
                  maxCharacters={500}
                />
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" gap="spacing.2" alignItems={{ base: "flex-start", l: "flex-end" }} minWidth="340px">
              <SegmentedControl
                accessibilityLabel={`Human validation for ${f.id}`}
                size="small"
                value={status}
                onChange={({ value }) => void save(f.id, value as HumanValidationStatus)}
                isDisabled={saving === f.id}
              >
                <SegmentedControlItem value="NOT_TESTED">Not tested</SegmentedControlItem>
                <SegmentedControlItem value="OBSERVED">Observed</SegmentedControlItem>
                <SegmentedControlItem value="NOT_OBSERVED">Not observed</SegmentedControlItem>
              </SegmentedControl>
              <Text size="xsmall" color="surface.text.gray.muted">
                {message[f.id] ?? "Recorded by you, not by FlowLens"}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function Section({
  id,
  title,
  note,
  aside,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box as="section" id={id} display="flex" flexDirection="column" gap="spacing.5">
      <Box display="flex" flexDirection="column" gap="spacing.2">
        <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
          <Heading as="h2" size="large">
            {title}
          </Heading>
          {aside}
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
