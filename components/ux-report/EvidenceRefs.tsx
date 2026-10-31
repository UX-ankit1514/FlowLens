"use client";

import { Box, Link, Text, Tooltip, TooltipInteractiveWrapper } from "@razorpay/blade/components";
import { useReportNav } from "./nav";

/** Inline references (S3, O1, C2…) that open the step or evidence they point to. */
export function EvidenceRefs({ refs, empty = "No linked evidence", max = 8 }: { refs: string[]; empty?: string; max?: number }) {
  const { go, labelOf } = useReportNav();
  if (refs.length === 0) {
    return (
      <Text size="small" color="surface.text.gray.muted">
        {empty}
      </Text>
    );
  }
  const shown = refs.slice(0, max);
  return (
    <Box display="flex" flexWrap="wrap" gap="spacing.3" alignItems="center">
      {shown.map((ref) => {
        const label = labelOf(ref);
        return (
          <Tooltip key={ref} content={label ? `${ref}: ${label}` : ref} placement="top">
            <TooltipInteractiveWrapper>
              <Link variant="button" size="small" onClick={() => go(ref)} accessibilityLabel={`Show ${ref}${label ? `: ${label}` : ""}`}>
                {ref}
              </Link>
            </TooltipInteractiveWrapper>
          </Tooltip>
        );
      })}
      {refs.length > max ? (
        <Text size="small" color="surface.text.gray.muted">
          +{refs.length - max} more
        </Text>
      ) : null}
    </Box>
  );
}
