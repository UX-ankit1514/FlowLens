"use client";

import { Box, Link, Text, Tooltip, TooltipInteractiveWrapper } from "@razorpay/blade/components";
import type { EvidenceItem } from "@/types";

/** Inline references (S3, O1, C2…) that jump to the evidence section. */
export function EvidenceRefs({ refs, evidence }: { refs: string[]; evidence: EvidenceItem[] }) {
  if (refs.length === 0) {
    return (
      <Text size="small" color="surface.text.gray.muted">
        No linked evidence
      </Text>
    );
  }
  const byRef = new Map(evidence.map((e) => [e.ref, e]));
  return (
    <Box display="flex" flexWrap="wrap" gap="spacing.3" alignItems="center">
      {refs.map((ref) => {
        const item = byRef.get(ref);
        const label = item ? `${ref}: ${item.label}` : `${ref} (not available)`;
        return (
          <Tooltip key={ref} content={label} placement="top">
            <TooltipInteractiveWrapper>
              <Link href={`#evidence-${ref}`} size="small" accessibilityLabel={`Evidence ${label}`}>
                {ref}
              </Link>
            </TooltipInteractiveWrapper>
          </Tooltip>
        );
      })}
    </Box>
  );
}
