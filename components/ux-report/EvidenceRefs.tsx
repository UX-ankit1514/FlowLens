"use client";

import { Fragment } from "react";
import { Box, Link, Text, Tooltip, TooltipInteractiveWrapper } from "@razorpay/blade/components";
import { refName, tokenizeRefs } from "@/lib/presentation/report-view";
import { useReportNav } from "./nav";

type TextSize = "xsmall" | "small" | "medium" | "large";

/** A single evidence reference shown by name ("Step 16"), opening the item it points to. */
export function RefLink({ refId, label, size = "small" }: { refId: string; label?: string; size?: TextSize }) {
  const { go, labelOf } = useReportNav();
  const name = label ?? refName(refId);
  const detail = labelOf(refId);
  return (
    <Tooltip content={detail ? `${name}: ${detail}` : name} placement="top">
      <TooltipInteractiveWrapper display="inline-block">
        <Link variant="button" size={size} onClick={() => go(refId)} accessibilityLabel={`Show ${name}${detail ? `: ${detail}` : ""}`}>
          {name}
        </Link>
      </TooltipInteractiveWrapper>
    </Tooltip>
  );
}

/** Inline references (Step 3, Obstacle 1, Criterion 2…) that open the step or evidence they point to. */
export function EvidenceRefs({ refs, empty = "No linked evidence", max = 8 }: { refs: string[]; empty?: string; max?: number }) {
  const unique = [...new Set(refs)];
  if (unique.length === 0) {
    return (
      <Text size="small" color="surface.text.gray.muted">
        {empty}
      </Text>
    );
  }
  const shown = unique.slice(0, max);
  return (
    <Box display="flex" flexWrap="wrap" columnGap="spacing.4" rowGap="spacing.2" alignItems="center">
      {shown.map((ref) => (
        <RefLink key={ref} refId={ref} />
      ))}
      {unique.length > max ? (
        <Text size="small" color="surface.text.gray.muted">
          +{unique.length - max} more
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Report text with any evidence codes it mentions ("…at S16", "C2 wasn't
 * met") turned into readable links ("…at Step 16", "Criterion 2 wasn't met").
 */
export function RefText({
  children,
  size = "medium",
  weight,
  color,
  truncateAfterLines,
}: {
  children: string;
  size?: TextSize;
  weight?: "regular" | "medium" | "semibold";
  color?: "surface.text.gray.normal" | "surface.text.gray.subtle" | "surface.text.gray.muted";
  truncateAfterLines?: number;
}) {
  const { known } = useReportNav();
  const tokens = tokenizeRefs(children, known);
  const hasRefs = tokens.some((t) => "ref" in t);
  return (
    // Links carry block-level tooltip wrappers, so text that holds refs renders as a div.
    <Text
      as={hasRefs ? "div" : "p"}
      size={size}
      weight={weight}
      color={color}
      wordBreak="break-word"
      truncateAfterLines={hasRefs ? undefined : truncateAfterLines}
    >
      {tokens.map((t, i) =>
        "ref" in t ? (
          <RefLink key={i} refId={t.ref} label={t.label} size={size} />
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </Text>
  );
}
