"use client";

import { createContext, useContext } from "react";
import type { JourneyStep } from "@/types";

/** Lets any evidence reference (S7, C2, O1…) jump to where it's shown in the report. */
export type ReportNav = {
  go: (ref: string) => void;
  labelOf: (ref: string) => string | undefined;
  /** True when the report holds this reference, so text mentioning it can link to it. */
  known: (ref: string) => boolean;
  /** The recorded step for an S# (or E#) reference, when there is one. */
  stepOf: (ref: string) => JourneyStep | undefined;
  sessionId: string;
};

export const ReportNavContext = createContext<ReportNav>({
  go: () => {},
  labelOf: () => undefined,
  known: () => false,
  stepOf: () => undefined,
  sessionId: "",
});

export function useReportNav(): ReportNav {
  return useContext(ReportNavContext);
}
