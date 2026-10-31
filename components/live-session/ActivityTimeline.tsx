"use client";

import { useEffect, useRef } from "react";
import { Box, StepGroup, StepItem, StepItemIndicator, Text } from "@razorpay/blade/components";
import { formatElapsed } from "@/lib/presentation/labels";
import type { SessionEvent } from "@/types";

const TONE_TO_COLOR = {
  neutral: "neutral",
  positive: "positive",
  notice: "notice",
  negative: "negative",
} as const;

type Props = {
  events: SessionEvent[];
  /** Elapsed times are measured from this instant (first event or provider start). */
  originTime?: string;
  isLive: boolean;
};

/**
 * The live activity feed. Shows only events actually received from TinyFish
 * (source "TinyFish") plus FlowLens lifecycle events (source "FlowLens").
 */
export function ActivityTimeline({ events, originTime, isLive }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (events.length === 0) {
    return (
      <Box paddingY="spacing.5">
        <Text size="small" color="surface.text.gray.muted">
          Waiting for the first event from TinyFish…
        </Text>
      </Box>
    );
  }

  const origin = Date.parse(originTime ?? events[0].timestamp);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Agent activity"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      style={{ maxHeight: "min(52vh, 560px)", overflowY: "auto", paddingRight: 4 }}
    >
      <StepGroup orientation="vertical" size="medium" width="100%">
        {events.map((event, index) => {
          const isLast = index === events.length - 1;
          const elapsed = formatElapsed(Date.parse(event.timestamp) - origin);
          const source = event.source === "provider" ? "TinyFish" : "FlowLens";
          return (
            <StepItem
              key={event.sequence}
              title={event.description}
              titleColor={
                event.tone === "negative"
                  ? "feedback.text.negative.intense"
                  : event.tone === "notice"
                    ? "feedback.text.notice.intense"
                    : undefined
              }
              timestamp={`#${event.sequence} · ${elapsed} · ${source}${event.evidenceRef ? ` · ${event.evidenceRef}` : ""}`}
              stepProgress={isLast ? (isLive ? "start" : "none") : "full"}
              marker={<StepItemIndicator color={TONE_TO_COLOR[event.tone]} />}
            />
          );
        })}
      </StepGroup>
    </div>
  );
}
