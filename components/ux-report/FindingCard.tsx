"use client";

import { Badge, Box, Heading, Link, Text } from "@razorpay/blade/components";
import { CATEGORY_VIEW, SEVERITY_VIEW, confidenceLabel, displayUrl, safeHttpUrl } from "@/lib/presentation/labels";
import type { EvidenceItem, UXFinding } from "@/types";
import { EvidenceRefs } from "./EvidenceRefs";

export function FindingCard({ finding, evidence, ruleBased }: { finding: UXFinding; evidence: EvidenceItem[]; ruleBased: boolean }) {
  const severity = SEVERITY_VIEW[finding.severity];
  return (
    <Box
      as="section"
      id={`finding-${finding.id}`}
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      padding="spacing.6"
      display="flex"
      flexDirection="column"
      gap="spacing.5"
    >
      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Box display="flex" flexWrap="wrap" gap="spacing.3" alignItems="center">
          <Badge color={severity.color} emphasis="subtle">
            {severity.label}
          </Badge>
          <Badge color="neutral" emphasis="subtle">
            {CATEGORY_VIEW[finding.category].label}
          </Badge>
          <Text size="small" color="surface.text.gray.muted">
            {finding.id} · {confidenceLabel(finding.confidence, finding.origin)}
          </Text>
        </Box>
        <Heading as="h4" size="small">
          {finding.title}
        </Heading>
      </Box>

      <Field label="Observation">{finding.observation}</Field>

      {finding.pageUrl ? (
        <Box display="flex" flexDirection="column" gap="spacing.1">
          <Text size="small" color="surface.text.gray.muted">
            Page
          </Text>
          <Box>
            <PageLink url={finding.pageUrl} />
          </Box>
        </Box>
      ) : null}

      {finding.personaRelevance ? <Field label="Why this matters for this persona">{finding.personaRelevance}</Field> : null}
      {finding.hypothesis ? <Field label="Possible explanation (hypothesis)">{finding.hypothesis}</Field> : null}
      <Field label={ruleBased ? "Suggested next action (rule-based)" : "Suggested next action"}>{finding.recommendation}</Field>

      <Box
        display="flex"
        flexDirection={{ base: "column", m: "row" }}
        gap={{ base: "spacing.3", m: "spacing.7" }}
        paddingTop="spacing.4"
        borderTopWidth="thin"
        borderTopColor="surface.border.gray.muted"
      >
        <Box display="flex" flexDirection="column" gap="spacing.2" flexShrink={0}>
          <Text size="small" color="surface.text.gray.muted">
            Evidence
          </Text>
          <EvidenceRefs refs={finding.evidenceRefs} evidence={evidence} />
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Text size="small" color="surface.text.gray.muted">
            Why this severity
          </Text>
          <Text size="small" color="surface.text.gray.subtle">
            {finding.severityRationale}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      <Text size="medium" wordBreak="break-word">
        {children}
      </Text>
    </Box>
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
