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
      if (finding.evidenceRefs.length === 0) expect(finding.confidence).toBe("INFERRED");
    }
  });

  it("justifies severity: a blocking obstacle on a failed criterion is HIGH", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    const missing = report.findings.find((f) => f.category === "MISSING_INFORMATION");
    expect(missing?.severity).toBe("HIGH");
    expect(missing?.severityRationale).toMatch(/stopped its progress/);
    expect(missing?.hypothesis).toMatch(/not found during this test/);
    const confusing = report.findings.find((f) => f.category === "CONFUSING_FLOW");
    expect(confusing?.severity).toBe("LOW");
  });

  it("derives repeated-visit friction only from recorded URLs, marked as inferred", () => {
    const report = buildEvidenceSummaryReport(makeSession(partialResult));
    const repeated = report.findings.find((f) => f.origin === "PATTERN");
    expect(repeated?.observation).toContain("3 times");
    expect(repeated?.confidence).toBe("INFERRED");
  });

  it("treats CAPTCHA as a test blocker, not a usability finding", () => {
    const report = buildEvidenceSummaryReport(makeSession(blockedResult));
    expect(report.taskOutcome).toBe("BLOCKED");
    expect(report.findings).toHaveLength(0);
    expect(report.blockers).toHaveLength(1);
    expect(report.outcomeRationale).toMatch(/not by itself a usability verdict/);
  });

  it("is inconclusive when the provider returned no structured result", () => {
    const report = buildEvidenceSummaryReport(makeSession(null));
    expect(report.taskOutcome).toBe("INCONCLUSIVE");
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
    expect(report.taskOutcome).toBe("INCONCLUSIVE");
    expect(report.findings).toHaveLength(0);
    expect(report.recommendations).toHaveLength(0);
  });

  it("does not turn a technical failure into a usability verdict", () => {
    const session = makeSession(null, { executionStatus: "FAILED" });
    const report = buildFallbackReport(session, "TinyFish had an infrastructure problem.");
    expect(report.taskOutcome).toBe("INCONCLUSIVE");
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
                findings: [
                  {
                    title: "Delivery cost hidden",
                    category: "MISSING_INFORMATION",
                    severity: "HIGH",
                    severity_rationale: "Blocked a criterion",
                    observation: "Delivery cost not shown in the cart",
                    hypothesis: "It may only appear at checkout",
                    persona_relevance: "Sam needs the delivery cost to budget.",
                    recommendation: "Show an estimate in the cart",
                    evidence_refs: ["O1", "C2"],
                    page_url: "https://shop.example.com/cart",
                    confidence: "VERIFIED",
                  },
                  {
                    title: "Invented claim",
                    category: "POTENTIAL_FRICTION",
                    severity: "LOW",
                    severity_rationale: "-",
                    observation: "Something not in evidence",
                    hypothesis: "",
                    persona_relevance: "",
                    recommendation: "Do something",
                    evidence_refs: ["Z9"],
                    page_url: null,
                    confidence: "VERIFIED",
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
    expect(report.findings[1].evidenceRefs).toEqual([]);
    expect(report.findings[1].confidence).toBe("UNCERTAIN");
    vi.doUnmock("@anthropic-ai/sdk");
  });
});
