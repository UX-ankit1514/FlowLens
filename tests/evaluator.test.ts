import { describe, expect, it, vi } from "vitest";
import {
  LIMITATION_AGENT,
  buildEvidenceSummaryReport,
  buildFallbackReport,
} from "@/lib/evaluator/evidence-summary";
import { blockedResult, makeSession, partialResult } from "./support/fixtures";

describe("evidence summary report", () => {
  it("decides the task outcome from the designer's criteria, not provider completion", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    expect(report.taskOutcome).toBe("PARTIAL");
    expect(report.checkpoints.map((c) => c.status)).toEqual(["PASSED", "FAILED"]);
    // Checkpoint text is the designer's criterion, verbatim.
    expect(report.checkpoints.map((c) => c.description)).toEqual(["Find a bulk flour product", "Find the delivery cost"]);
  });

  it("backs every finding with evidence that exists", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    const refs = new Set(report.evidence.map((e) => e.ref));
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      for (const ref of finding.evidenceRefs) expect(refs.has(ref), `${finding.id} cites ${ref}`).toBe(true);
    }
  });

  it("connects a reported obstacle to the criterion it affected and gives a specific action", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    const missing = report.findings.find((f) => f.evidenceRefs.includes("O1"));
    expect(missing?.kind).toBe("USABILITY_HYPOTHESIS");
    expect(missing?.affectsCriteria).toContain("C2");
    expect(missing?.designerAction).toMatch(/cart|delivery/i);
  });

  it("records journey patterns separately from usability findings", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    expect(report.journey.patterns.length).toBeGreaterThan(0);
    expect(report.journey.patterns.every((pattern) => pattern.origin === "RULES")).toBe(true);
  });

  it("treats CAPTCHA as a test blocker, not a usability finding", () => {
    const report = buildEvidenceSummaryReport(makeSession(blockedResult));
    expect(report.taskOutcome).toBe("BLOCKED");
    expect(report.findings).toHaveLength(0);
    expect(report.technicalBlockers).toHaveLength(1);
    expect(report.outcomeRationale).toMatch(/not by itself a usability verdict/);
  });

  it("is inconclusive when the provider returned no structured result", () => {
    const report = buildEvidenceSummaryReport(makeSession(null));
    expect(report.taskOutcome).toBe("NOT_VERIFIED");
    expect(report.findings).toHaveLength(0);
    expect(report.checkpoints.every((c) => c.status === "NOT_VERIFIED")).toBe(true);
    expect(report.structuredResultValid).toBe(false);
  });

  it("always includes the research limitation statement and labels the method honestly", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    expect(report.limitations[0]).toBe(LIMITATION_AGENT);
    expect(report.method).toBe("EVIDENCE_SUMMARY");
    expect(report.methodNote).toMatch(/No AI interpretation/);
  });

  it("never reports a cancelled session as completed and produces no findings", () => {
    const session = makeSession(partialResult, { executionStatus: "CANCELLED" });
    const report = buildFallbackReport(session, "Stopped by the designer.");
    expect(report.taskOutcome).toBe("NOT_VERIFIED");
    expect(report.findings).toHaveLength(0);
  });

  it("does not turn a technical failure into a usability verdict", () => {
    const session = makeSession(null, { executionStatus: "FAILED" });
    const report = buildFallbackReport(session, "TinyFish had an infrastructure problem.");
    expect(report.taskOutcome).toBe("NOT_VERIFIED");
    expect(report.findings).toHaveLength(0);
  });
});

describe("AI interpretation layer", () => {
  it("cannot change observed outcomes and downgrades findings with unverifiable evidence", async () => {
    vi.resetModules();
    vi.doMock("@anthropic-ai/sdk", () => {
      class FakeAnthropic {
        beta = {
          messages: {
            parse: async () => ({
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              parsed_output: {
                summary: "The delivery cost was the main gap.",
                next_action: "Show a delivery estimate in the cart.",
                checkpoint_reviews: [],
                patterns: [],
                findings: [
                  {
                    kind: "USABILITY_HYPOTHESIS",
                    title: "Delivery cost hidden",
                    what_happened: "Delivery cost not shown in the cart",
                    step_refs: [],
                    persona_impact: "Sam needs the delivery cost to budget.",
                    designer_action: "Show an estimate in the cart",
                    caveat: null,
                    evidence_refs: ["O1", "C2"],
                    affects_criteria: ["C2"],
                    page_url: "https://shop.example.com/cart",
                  },
                  {
                    kind: "USABILITY_HYPOTHESIS",
                    title: "Invented claim",
                    what_happened: "Something not in evidence",
                    step_refs: [],
                    persona_impact: "",
                    designer_action: "Do something",
                    caveat: null,
                    evidence_refs: ["Z9"],
                    affects_criteria: [],
                    page_url: null,
                  },
                ],
              },
            }),
          },
        };
      }
      return { default: FakeAnthropic };
    });
    const { interpretWithAi } = await import("@/lib/evaluator/ai-evaluator");
    const session = makeSession(partialResult);
    const base = buildEvidenceSummaryReport(session);
    const report = await interpretWithAi(session, base);

    expect(report.method).toBe("AI_INTERPRETATION");
    expect(report.taskOutcome).toBe(base.taskOutcome);
    expect(report.checkpoints).toEqual(base.checkpoints);
    expect(report.findings[0].evidenceRefs).toEqual(["O1", "C2"]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].origin).toBe("AI");
    vi.doUnmock("@anthropic-ai/sdk");
  });
});
