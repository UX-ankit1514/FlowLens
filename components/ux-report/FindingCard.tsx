"use client";

import { Badge, Box, Heading, InfoIcon, Link, Text } from "@razorpay/blade/components";
import { FINDING_KIND_VIEW, displayUrl, findingOriginLabel, safeHttpUrl } from "@/lib/presentation/labels";
import { SEVERITY_VIEW, refName, type Severity } from "@/lib/presentation/report-view";
import type { HumanValidation, UXFinding } from "@/types";
import { EvidenceImage } from "./EvidenceImage";
import { EvidenceRefs, RefLink, RefText } from "./EvidenceRefs";
import { useReportNav } from "./nav";
import { screenshotUrl } from "./Thumb";
import { ValidationControl } from "./ValidationControl";

/**
 * One issue, laid out the way usability reports are read: severity and type
 * first, then what happened (with the screenshot of that moment), why it
 * matters for this persona, and what to do about it.
 */
export function FindingCard({
  finding,
  severity,
  validation,
  onValidationChanged,
}: {
  finding: UXFinding;
  severity: Severity;
  validation?: HumanValidation;
  onValidationChanged: () => void;
}) {
  const { stepOf, sessionId } = useReportNav();
  const kind = FINDING_KIND_VIEW[finding.kind];
  const sev = SEVERITY_VIEW[severity];
  const shot = finding.stepRefs.map((ref) => stepOf(ref)).find((s) => s?.hasScreenshot && s.stepId);
  const evidence = finding.evidenceRefs.filter((r) => !finding.affectsCriteria.includes(r));

  return (
    <Box
      as="section"
      id={`finding-${finding.id}`}
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <Box padding={{ base: "spacing.5", m: "spacing.7" }} display="flex" flexDirection="column" gap="spacing.5">
        {/* Severity, type and what it affects */}
        <Box display="flex" flexDirection="column" gap="spacing.3">
          <Box display="flex" flexWrap="wrap" gap="spacing.3" alignItems="center">
            <Badge color={sev.color} emphasis={severity === "HIGH" ? "intense" : "subtle"}>
              {sev.label}
            </Badge>
            <Badge color="neutral" emphasis="subtle">
              {kind.label}
            </Badge>
            {finding.affectsCriteria.length ? (
              <Box display="flex" gap="spacing.2" alignItems="center" flexWrap="wrap">
                <Text size="small" color="surface.text.gray.muted">
                  Affects
                </Text>
                {finding.affectsCriteria.map((c) => (
                  <RefLink key={c} refId={c} />
                ))}
              </Box>
            ) : null}
          </Box>
          <Heading as="h3" size="medium">
            {finding.title}
          </Heading>
        </Box>

        <Box
          display="grid"
          gridTemplateColumns={{ base: "minmax(0, 1fr)", l: shot ? "minmax(0, 1fr) 320px" : "minmax(0, 1fr)" }}
          gap="spacing.7"
          alignItems="start"
        >
          <Box display="flex" flexDirection="column" gap="spacing.5" minWidth="0px">
            <Field label="What happened">
              <RefText>{finding.whatHappened}</RefText>
            </Field>

            {finding.personaImpact ? (
              <Field label="Why it matters for this persona">
                <RefText>{finding.personaImpact}</RefText>
              </Field>
            ) : null}

            <Box
              backgroundColor="surface.background.primary.faint"
              borderRadius="medium"
              padding="spacing.5"
              display="flex"
              flexDirection="column"
              gap="spacing.2"
            >
              <Text size="small" weight="semibold" color="interactive.text.primary.normal">
                What to do
              </Text>
              <RefText weight="medium">{finding.designerAction}</RefText>
            </Box>

            <Field label="Where">
              <Box display="flex" flexWrap="wrap" columnGap="spacing.4" rowGap="spacing.2" alignItems="center" minWidth="0px">
                {finding.pageUrl ? <PageLink url={finding.pageUrl} /> : null}
                {finding.stepRefs.length ? (
                  <EvidenceRefs refs={finding.stepRefs} max={6} />
                ) : !finding.pageUrl ? (
                  <Text size="small" color="surface.text.gray.muted">
                    Not linked to a specific step
                  </Text>
                ) : null}
              </Box>
            </Field>
          </Box>

          {shot?.stepId ? (
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <EvidenceImage src={screenshotUrl(sessionId, shot.stepId)} refLabel={refName(shot.ref)} action={shot.statedPurpose} />
              <Text size="xsmall" color="surface.text.gray.muted" truncateAfterLines={2}>
                {`${refName(shot.ref)} · ${shot.statedPurpose || "Screenshot"}`}
              </Text>
            </Box>
          ) : null}
        </Box>

        {finding.caveat ? (
          <Box display="flex" gap="spacing.3" alignItems="flex-start" backgroundColor="feedback.background.notice.subtle" borderRadius="small" padding="spacing.4">
            <Box flexShrink={0} paddingTop="spacing.1">
              <InfoIcon size="small" color="feedback.icon.notice.intense" />
            </Box>
            <Box display="flex" flexDirection="column" gap="spacing.1">
              <Text size="small" weight="semibold">
                Before you act on this
              </Text>
              <RefText size="small" color="surface.text.gray.subtle">
                {finding.caveat}
              </RefText>
            </Box>
          </Box>
        ) : null}
      </Box>

      {/* Footer: designer's own check, and the evidence behind the issue */}
      <Box
        backgroundColor="surface.background.gray.moderate"
        borderTopWidth="thin"
        borderTopColor="surface.border.gray.muted"
        paddingX={{ base: "spacing.5", m: "spacing.7" }}
        paddingY="spacing.5"
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "minmax(0, 1fr) auto" }}
        gap="spacing.5"
        alignItems="start"
      >
        <ValidationControl
          sessionId={sessionId}
          findingId={finding.id}
          findingTitle={finding.title}
          saved={validation}
          onChanged={onValidationChanged}
        />
        <Box display="flex" flexDirection="column" gap="spacing.2" alignItems={{ base: "flex-start", l: "flex-end" }}>
          <Text size="xsmall" color="surface.text.gray.muted">
            {`Based on · ${findingOriginLabel(finding.origin)}`}
          </Text>
          <EvidenceRefs refs={evidence} empty="No linked evidence" max={5} />
        </Box>
      </Box>
    </Box>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
      <Text size="small" weight="semibold" color="surface.text.gray.muted">
        {label}
      </Text>
      {children}
    </Box>
  );
}

/** Links ordinary web addresses; shows anything else as plain text. */
export function PageLink({ url }: { url: string }) {
  // Agent-reported text like "a.com and b.com" isn't one address, so it isn't linked.
  const safe = /\s/.test(url.trim()) ? undefined : safeHttpUrl(url);
  if (!safe) {
    return (
      <Text size="small" color="surface.text.gray.subtle" wordBreak="break-all">
        {url}
      </Text>
    );
  }
  return (
    <Link href={safe} target="_blank" rel="noopener noreferrer nofollow" size="small">
      {displayUrl(safe)}
    </Link>
  );
}
