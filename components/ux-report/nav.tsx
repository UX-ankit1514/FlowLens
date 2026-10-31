"use client";

import { createContext, useContext } from "react";

/** Lets any evidence reference (S7, C2, O1…) jump to where it's shown in the report. */
export type ReportNav = {
  go: (ref: string) => void;
  labelOf: (ref: string) => string | undefined;
};

export const ReportNavContext = createContext<ReportNav>({ go: () => {}, labelOf: () => undefined });

export function useReportNav(): ReportNav {
  return useContext(ReportNavContext);
}
