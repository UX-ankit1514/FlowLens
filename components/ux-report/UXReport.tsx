"use client";

import { useState } from "react";
import {
  Alert,
  announce,
  ArrowLeftIcon,
  Badge,
  Box,
  Button,
  CheckIcon,
  CopyIcon,
  Divider,
  Heading,
  InfoIcon,
  Link,
  RefreshIcon,
  Spinner,
  Text,
} from "@razorpay/blade/components";
import { useSession } from "@/lib/client/useSession";
import {
  CATEGORY_ORDER,
  CATEGORY_VIEW,
  CHECKPOINT_VIEW,
  TASK_OUTCOME_VIEW,
  displayUrl,
  formatDateTime,
  formatElapsed,
  sessionStatusView,
} from "@/lib/presentation/labels";
import type { Severity, TestSession, UsabilityReport } from "@/types";
import { SessionLoadFailed, SessionLoading, SessionNotFound } from "@/components/ui/SessionStates";
import { EvidenceRefs } from "./EvidenceRefs";
import { EvidenceImage } from "./EvidenceImage";
import { EvidenceSection } from "./EvidenceSection";
import { screenshotUrl } from "./Thumb";
import { FindingCard } from "./FindingCard";
import { buildSummaryText } from "./summaryText";

const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function UXReport({ id }: { id: string }) {
  const { session, loadError, refetch } = useSession(id);

  if (loadError === "not-found") return <SessionNotFound />;
  if (loadError === "network" && !session) return <SessionLoadFailed onRetry={() => void refetch()} />;
  if (!session) return <SessionLoading />;

  if (!session.report) {
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

  return <ReportBody session={session} report={session.report} />;
}

function ReportBody({ session, report }: { session: TestSession; report: UsabilityReport }) {
  const [copied, setCopied] = useState(false);
  const d = session.definition;
  const outcome = TASK_OUTCOME_VIEW[report.taskOutcome];
  const status = sessionStatusView(session);
  const ruleBased = report.method === "EVIDENCE_SUMMARY";
  const findings = [...report.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const stopped = session.executionStatus !== "COMPLETED";

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
    <Box display="flex" flexDirection="column" gap="spacing.10">
      {/* A — Session summary */}
      <Box as="section" display="flex" flexDirection="column" gap="spacing.6">
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
          <Text size="small" color="surface.text.gray.muted">
            UX report
          </Text>
          <Heading as="h1" size="xlarge" wordBreak="break-word">
            {d.sessionName || d.goal}
          </Heading>
        </Box>

        <Box
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
            <Text size="small" color="surface.text.gray.muted">
              Task outcome
            </Text>
            <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
              <Badge color={outcome.color} emphasis="intense" size="large">
                {outcome.label}
              </Badge>
              <Text size="small" color="surface.text.gray.muted">
                {outcome.description}
              </Text>
            </Box>
            <Text size="large" weight="medium">
              {report.outcomeRationale}
            </Text>
            <Text size="medium" color="surface.text.gray.subtle">
              {report.summary}
            </Text>
          </Box>

          {report.agentSummary || report.finalAnswer ? (
            <Box
              backgroundColor="surface.background.gray.moderate"
              borderRadius="medium"
              padding="spacing.5"
              display="flex"
              flexDirection="column"
              gap="spacing.3"
            >
              {report.agentSummary ? (
                <Box display="flex" flexDirection="column" gap="spacing.1">
                  <Text size="small" color="surface.text.gray.muted">
                    The agent&apos;s own account
                  </Text>
                  <Text size="medium" wordBreak="break-word">
                    {report.agentSummary}
                  </Text>
                </Box>
              ) : null}
              {report.finalAnswer ? (
                <Box display="flex" flexDirection="column" gap="spacing.1">
                  <Text size="small" color="surface.text.gray.muted">
                    What the agent found
                  </Text>
                  <Text size="medium" wordBreak="break-word">
                    {report.finalAnswer}
                  </Text>
                </Box>
              ) : null}
            </Box>
          ) : null}

          <Divider />

          <Box
            display="grid"
            gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "repeat(2, minmax(0, 1fr))", l: "repeat(4, minmax(0, 1fr))" }}
            gap="spacing.6"
          >
            <Meta label="Website">
              <Link href={d.websiteUrl} target="_blank" rel="noopener noreferrer" size="medium">
                {displayUrl(d.websiteUrl)}
              </Link>
            </Meta>
            <Meta label="Session date">
              <Text size="medium">{formatDateTime(session.startedAt ?? session.createdAt)}</Text>
            </Meta>
            <Meta label="Execution status">
              <Box display="flex" gap="spacing.3" alignItems="center">
                <Badge color={status.color} emphasis="subtle">
                  {status.label}
                </Badge>
                {session.startedAt && session.finishedAt ? (
                  <Text size="small" color="surface.text.gray.muted">
                    {formatElapsed(Date.parse(session.finishedAt) - Date.parse(session.startedAt))}
                  </Text>
                ) : null}
              </Box>
            </Meta>
            <Meta label="Analysis">
              <Text size="medium">{ruleBased ? "Evidence summary" : "AI interpretation"}</Text>
            </Meta>
          </Box>

          <Box display="grid" gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "repeat(2, minmax(0, 1fr))" }} gap="spacing.6">
            <Meta label="Persona (as supplied)">
              <Box whiteSpace="pre-line">
                <Text size="medium" wordBreak="break-word">
                  {d.persona.description}
                </Text>
              </Box>
            </Meta>
            <Meta label="Task">
              <Text size="medium" wordBreak="break-word">
                {d.goal}
              </Text>
            </Meta>
          </Box>

          <Box display="flex" gap="spacing.3" alignItems="flex-start">
            <Box flexShrink={0} paddingTop="spacing.1">
              <InfoIcon size="small" color="surface.icon.gray.muted" />
            </Box>
            <Text size="small" color="surface.text.gray.muted">
              {report.methodNote}
            </Text>
          </Box>
        </Box>

        {report.aiUnavailableReason ? (
          <Alert
            color="notice"
            isFullWidth
            isDismissible={false}
            title="AI interpretation wasn't available"
            description={`This report is an evidence summary only, because ${report.aiUnavailableReason}.`}
          />
        ) : null}
        {stopped && session.error ? (
          <Alert color="negative" isFullWidth isDismissible={false} title="The run failed" description={session.error.message} />
        ) : null}
      </Box>

      {/* B — Task checkpoints */}
      <ReportSection id="checkpoints" title="Task checkpoints" note="Each success criterion you defined, with what the agent observed.">
        <Box display="flex" flexDirection="column">
          {report.checkpoints.map((c) => {
            const view = CHECKPOINT_VIEW[c.status];
            return (
              <Box
                key={c.id}
                display="grid"
                gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "120px minmax(0, 1fr) 120px" }}
                gap={{ base: "spacing.3", m: "spacing.6" }}
                paddingY="spacing.5"
                borderBottomWidth="thin"
                borderBottomColor="surface.border.gray.muted"
                alignItems="start"
              >
                <Box>
                  <Badge color={view.color} emphasis="subtle">
                    {view.label}
                  </Badge>
                </Box>
                <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
                  <Text size="medium" weight="semibold" wordBreak="break-word">
                    {c.description}
                  </Text>
                  {c.observation ? (
                    <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">
                      Agent: {c.observation}
                    </Text>
                  ) : (
                    <Text size="small" color="surface.text.gray.muted">
                      No observation recorded.
                    </Text>
                  )}
                </Box>
                <EvidenceRefs refs={c.evidenceRefs} evidence={report.evidence} />
              </Box>
            );
          })}
        </Box>
      </ReportSection>

      {/* C — Journey timeline */}
      <ReportSection id="journey" title="Journey timeline" note="The sequence of actions TinyFish reported while the agent worked, with the step screenshot where one exists.">
        <JourneyTimeline session={session} />
      </ReportSection>

      {/* D — Usability findings overview */}
      <ReportSection id="findings" title="Usability findings" note={stopped ? undefined : "Potential issues observed during this session, grouped by type."}>
        {stopped ? (
          <Text color="surface.text.gray.muted">
            This session didn&apos;t finish, so no usability findings were produced. A failed or stopped run is not by itself
            evidence of a usability problem.
          </Text>
        ) : (
          <Box display="flex" flexDirection="column" gap="spacing.7">
            <Box
              display="grid"
              gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "repeat(2, minmax(0, 1fr))", l: "repeat(5, minmax(0, 1fr))" }}
              gap="spacing.4"
            >
              {CATEGORY_ORDER.map((category) => {
                const count = report.findings.filter((f) => f.category === category).length;
                return (
                  <OverviewTile
                    key={category}
                    label={CATEGORY_VIEW[category].plural}
                    value={count === 0 ? "None observed" : `${count} ${count === 1 ? "finding" : "findings"}`}
                    muted={count === 0}
                    description={CATEGORY_VIEW[category].description}
                  />
                );
              })}
              <OverviewTile label="Task completion" value={outcome.label} description={report.outcomeRationale} />
            </Box>

            {report.blockers.length > 0 ? (
              <Box
                borderWidth="thin"
                borderColor="surface.border.gray.muted"
                borderRadius="medium"
                padding="spacing.5"
                display="flex"
                flexDirection="column"
                gap="spacing.3"
              >
                <Text weight="semibold">Test blockers</Text>
                <Text size="small" color="surface.text.gray.muted">
                  These stopped or limited the test. They are test limitations, not usability findings.
                </Text>
                {report.blockers.map((b) => (
                  <Box key={b.id} display="flex" flexDirection="column" gap="spacing.1">
                    <Text size="medium">
                      <Text as="span" weight="semibold">
                        {b.kind}:
                      </Text>{" "}
                      {b.description}
                    </Text>
                    <EvidenceRefs refs={b.evidenceRefs} evidence={report.evidence} />
                  </Box>
                ))}
              </Box>
            ) : null}

            {/* E — Detailed finding cards */}
            {findings.length === 0 ? (
              <Text color="surface.text.gray.muted">
                The agent didn&apos;t report any obstacles on this journey. That isn&apos;t proof the journey is free of
                usability problems; it means none were observed in this session.
              </Text>
            ) : (
              <Box display="flex" flexDirection="column" gap="spacing.5">
                {findings.map((f) => (
                  <FindingCard key={f.id} finding={f} evidence={report.evidence} ruleBased={ruleBased} />
                ))}
              </Box>
            )}
          </Box>
        )}
      </ReportSection>

      {/* F — Evidence */}
      <ReportSection id="evidence" title="Evidence" note="Everything this report is based on. References like S3 or O1 above link here.">
        <EvidenceSection session={session} report={report} />
      </ReportSection>

      {/* G — Recommendations */}
      <ReportSection
        id="recommendations"
        title="Recommendations"
        note={ruleBased ? "Rule-based next steps derived from each observation. Validate changes with real users." : "Next steps tied to each observation. Validate changes with real users."}
      >
        {report.recommendations.length === 0 ? (
          <Text color="surface.text.gray.muted">
            No recommendations. FlowLens only recommends changes that are backed by an observation from this session.
          </Text>
        ) : (
          <Box as="span" display="flex" flexDirection="column">
            {report.recommendations.map((r, i) => (
              <Box
                key={r.id}
                display="grid"
                gridTemplateColumns="32px minmax(0, 1fr)"
                gap="spacing.4"
                paddingY="spacing.5"
                borderBottomWidth="thin"
                borderBottomColor="surface.border.gray.muted"
              >
                <Text weight="semibold" color="surface.text.gray.muted">
                  {i + 1}
                </Text>
                <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
                  <Text weight="semibold" wordBreak="break-word">
                    {r.recommendation}
                  </Text>
                  <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">
                    Observation: {r.observation}
                  </Text>
                  {r.hypothesis ? (
                    <Text size="small" color="surface.text.gray.subtle" wordBreak="break-word">
                      Hypothesis: {r.hypothesis}
                    </Text>
                  ) : null}
                  {r.findingId ? (
                    <Box>
                      <Link href={`#finding-${r.findingId}`} size="small">
                        {`See finding ${r.findingId}`}
                      </Link>
                    </Box>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </ReportSection>

      {/* H — Research limitations */}
      <ReportSection id="limitations" title="Research limitations">
        <Box
          backgroundColor="surface.background.gray.moderate"
          borderRadius="medium"
          padding="spacing.6"
          display="flex"
          flexDirection="column"
          gap="spacing.3"
        >
          <Text weight="semibold">{report.limitations[0]}</Text>
          {report.limitations.slice(1).map((l, i) => (
            <Text key={i} size="small" color="surface.text.gray.subtle">
              {l}
            </Text>
          ))}
        </Box>
      </ReportSection>

      <Box display="flex" gap="spacing.3" flexWrap="wrap" paddingBottom="spacing.8">
        <Button href={`/?from=${session.id}`} icon={RefreshIcon}>
          Run another test
        </Button>
        <Button variant="secondary" href="/">
          Start a new test
        </Button>
      </Box>
    </Box>
  );
}

function ReportSection({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <Box as="section" id={id} display="flex" flexDirection="column" gap="spacing.5">
      <Box display="flex" flexDirection="column" gap="spacing.2">
        <Heading as="h2" size="large">
          {title}
        </Heading>
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

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      {children}
    </Box>
  );
}

function OverviewTile({ label, value, description, muted }: { label: string; value: string; description: string; muted?: boolean }) {
  return (
    <Box
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      padding="spacing.5"
      display="flex"
      flexDirection="column"
      gap="spacing.2"
    >
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      <Text size="large" weight="semibold" color={muted ? "surface.text.gray.muted" : "surface.text.gray.normal"}>
        {value}
      </Text>
      <Text size="small" color="surface.text.gray.muted" truncateAfterLines={3}>
        {description}
      </Text>
    </Box>
  );
}

const JOURNEY_PREVIEW = 12;

function JourneyTimeline({ session }: { session: TestSession }) {
  const [showAll, setShowAll] = useState(false);
  const allEvents = session.events.filter((e) => e.source === "provider");
  const events = showAll ? allEvents : allEvents.slice(0, JOURNEY_PREVIEW);
  const steps = new Map(session.steps.map((s) => [s.ref, s]));
  const origin = Date.parse(session.startedAt ?? session.createdAt);

  if (allEvents.length === 0) {
    return (
      <Text color="surface.text.gray.muted">
        No events were received from TinyFish for this session.
      </Text>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.4">
    <Box as="span" display="flex" flexDirection="column">
      {events.map((event, index) => {
        const step = event.evidenceRef ? steps.get(event.evidenceRef) : undefined;
        return (
          <Box
            key={event.id}
            id={`evidence-${event.id}`}
            display="grid"
            gridTemplateColumns={{ base: "40px minmax(0, 1fr)", m: "40px minmax(0, 1fr) 176px" }}
            gap="spacing.4"
            paddingY="spacing.4"
            borderBottomWidth={index === events.length - 1 ? undefined : "thin"}
            borderBottomColor="surface.border.gray.muted"
            alignItems="start"
          >
            <Text size="small" weight="semibold" color="surface.text.gray.muted">
              {index + 1}
            </Text>
            <Box display="flex" flexDirection="column" gap="spacing.1" minWidth="0px">
              <Text
                size="medium"
                wordBreak="break-word"
                color={event.tone === "negative" ? "feedback.text.negative.intense" : "surface.text.gray.normal"}
              >
                {event.description}
              </Text>
              <Text size="small" color="surface.text.gray.muted">
                {event.id} · {formatElapsed(Date.parse(event.timestamp) - origin)}
                {step ? ` · ${step.ref}${step.duration ? ` · took ${step.duration}` : ""}` : ""}
              </Text>
            </Box>
            {step?.hasScreenshot ? (
              <Box display={{ base: "none", m: "block" }}>
                <EvidenceImage src={screenshotUrl(session.id, step.stepId)} refLabel={step.ref} action={step.action} />
              </Box>
            ) : (
              <Box display={{ base: "none", m: "block" }} />
            )}
          </Box>
        );
      })}
    </Box>
    {allEvents.length > JOURNEY_PREVIEW ? (
      <Box>
        <Button variant="tertiary" size="small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer steps" : `Show all ${allEvents.length} steps`}
        </Button>
      </Box>
    ) : null}
    </Box>
  );
}
