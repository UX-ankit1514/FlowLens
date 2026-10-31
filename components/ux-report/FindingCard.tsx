"use client";

import { Badge, Box, Heading, InfoIcon, Link, Text } from "@razorpay/blade/components";
import { FINDING_KIND_VIEW, VALIDATION_VIEW, displayUrl, safeHttpUrl } from "@/lib/presentation/labels";
import type { HumanValidationStatus, UXFinding } from "@/types";
import { EvidenceRefs } from "./EvidenceRefs";

export function FindingCard({ finding, validation }: { finding: UXFinding; validation: HumanValidationStatus }) {
  const kind = FINDING_KIND_VIEW[finding.kind];
  return (
    <Box
      as="section"
      id={`finding-${finding.id}`}
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      padding={{ base: "spacing.5", m: "spacing.6" }}
      display="flex"
      flexDirection="column"
      gap="spacing.5"
    >
      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Box display="flex" flexWrap="wrap" gap="spacing.3" alignItems="center">
          <Badge color={kind.color} emphasis="subtle">
            {kind.label}
          </Badge>
          {finding.affectsCriteria.length ? (
            <Badge color="neutral" emphasis="subtle">{`Affects ${finding.affectsCriteria.join(", ")}`}</Badge>
          ) : null}
          <Text size="small" color="surface.text.gray.muted">
            {`${finding.id} · ${finding.origin === "AI" ? "AI interpretation" : "Rule-based"} · Human validation: ${VALIDATION_VIEW[validation].label.toLowerCase()}`}
          </Text>
        </Box>
        <Heading as="h3" size="small">
          {finding.title}
        </Heading>
      </Box>

      <Box display="grid" gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "160px minmax(0, 1fr)" }} columnGap="spacing.6" rowGap="spacing.4">
        <Label>What happened</Label>
        <Text size="medium" wordBreak="break-word">
          {finding.whatHappened}
        </Text>

        <Label>Where</Label>
        <Box display="flex" flexDirection="column" gap="spacing.2" minWidth="0px">
          <EvidenceRefs refs={finding.stepRefs} empty="Not linked to a specific step" />
          {finding.pageUrl ? <PageLink url={finding.pageUrl} /> : null}
        </Box>

        {finding.personaImpact ? (
          <>
            <Label>Why it matters</Label>
            <Text size="medium" wordBreak="break-word">
              {finding.personaImpact}
            </Text>
          </>
        ) : null}

        <Label>Investigate or change</Label>
        <Text size="medium" weight="semibold" wordBreak="break-word">
          {finding.designerAction}
        </Text>

        <Label>Evidence</Label>
        <EvidenceRefs refs={finding.evidenceRefs} />
      </Box>

      {finding.caveat ? (
        <Box display="flex" gap="spacing.3" alignItems="flex-start" backgroundColor="feedback.background.notice.subtle" borderRadius="small" padding="spacing.4">
          <Box flexShrink={0} paddingTop="spacing.1">
            <InfoIcon size="small" color="feedback.icon.notice.intense" />
          </Box>
          <Text size="small" color="surface.text.gray.subtle">
            {finding.caveat}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text size="small" color="surface.text.gray.muted">
      {children}
    </Text>
  );
}

/** Links ordinary web addresses; shows anything else as plain text. */
export function PageLink({ url }: { url: string }) {
  const safe = safeHttpUrl(url);
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
