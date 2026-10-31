import { describe, expect, it } from "vitest";
import { buildEvidenceSummaryReport } from "@/lib/evaluator/evidence-summary";
import { mergeAiReport } from "@/lib/evaluator/ai-evaluator";
import { makeSession } from "./support/fixtures";

const steps = [
  "Access the AI travel assistant",
  "Bypass DataDome bot detection to access the site",
  "Access the AI travel assistant",
  "Type the travel request",
  "Type the travel request",
  "Task completed",
].map((action, i, all) => ({
  ref: `S${i + 1}`,
  stepId: `st-${i + 1}`,
  timestamp: `2026-10-31T08:00:${String(10 + i * 5).padStart(2, "0")}Z`,
  action,
  status: i === all.length - 1 ? "COMPLETED" : "RUNNING",
  duration: "1.0s",
  hasScreenshot: i !== all.length - 1,
}));

const allPassed = {
  task_outcome: "completed",
  outcome_summary: "Done.",
  checkpoints: [
    { criterion: "Find a bulk flour product", status: "passed", observation: "10kg flour listed at $18" },
    { criterion: "Find the delivery cost", status: "passed", observation: "The page redirected to a bot detection page; details came from the chat." },
  ],
  actions: [{ description: "Reconfigured browser with a US proxy to continue", result: "succeeded" }],
  obstacles: [
    { kind: "other", description: "Had to use a US proxy to get past the DataDome block.", blocked_progress: false },
  ],
  urls_visited: [],
};

describe("journey report", () => {
  const report = buildEvidenceSummaryReport(makeSession(allPassed, { steps, events: [] }));

  it("never treats a provider-completed run as verified success", () => {
    expect(report.taskOutcome).toBe("REPORTED_COMPLETE");
    expect(report.checkpoints[0].verification).toBe("AGENT_REPORTED");
    expect(report.checkpoints[1].verification).toBe("LIMITED");
  });

  it("keeps bot protection and proxy changes out of UX findings", () => {
    expect(report.findings).toHaveLength(0);
    expect(report.technicalBlockers.map((b) => b.kind).sort()).toEqual(["BOT_PROTECTION", "PROXY_OR_NETWORK"]);
    expect(report.journey.steps[1].flags.map((f) => f.kind)).toEqual(["TECHNICAL"]);
  });

  it("builds a chronological step trace and only flags repeats the evidence supports", () => {
    expect(report.journey.completeness).toBe("STEP_LEVEL");
    expect(report.journey.steps.map((s) => s.ref)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    expect(report.journey.steps[5].terminal).toBe("COMPLETED");
    // S3 repeats S1 only because bot protection interrupted: not counted.
    expect(report.journey.steps[2].flags).toHaveLength(0);
    expect(report.journey.steps[4].flags.map((f) => f.kind)).toContain("RETRY");
    expect(report.journey.steps[0].result).toBeUndefined();
  });

  it("labels a trace built only from live progress events as incomplete", () => {
    const progressOnly = buildEvidenceSummaryReport(makeSession(allPassed, { steps: [] }));
    expect(progressOnly.journey.completeness).toBe("PROGRESS_ONLY");
    expect(progressOnly.journey.completenessNote).toMatch(/Incomplete trace/);
    expect(progressOnly.journey.steps.every((s) => !s.hasScreenshot)).toBe(true);
  });

  it("accepts AI conclusions only when they cite evidence it actually saw", () => {
    const session = makeSession(allPassed, { steps, events: [] });
    const merged = mergeAiReport(
      session,
      report,
      {
        summary: "Worked.",
        next_action: "Check C2.",
        checkpoint_reviews: [
          { id: "C1", verdict: "CONFIRMED_IN_SCREENSHOT", evidence_refs: ["S5"], note: "Visible in S5." },
          { id: "C2", verdict: "CONFIRMED_IN_SCREENSHOT", evidence_refs: ["S4"], note: "Not actually shown." },
        ],
        patterns: [
          { kind: "REPEATED_ACTION", title: "Typed twice", description: "S4 and S5", step_refs: ["S4", "S5"], evidence_refs: [] },
          { kind: "DEAD_END", title: "Invented", description: "-", step_refs: ["S99"], evidence_refs: ["Z1"] },
        ],
        findings: [
          {
            kind: "USABILITY_HYPOTHESIS", title: "Bot wall blocks people", what_happened: "DataDome bot protection appeared",
            step_refs: ["S2"], page_url: null, persona_impact: "", designer_action: "Remove the bot check", caveat: null,
            evidence_refs: ["O1"], affects_criteria: [],
          },
          {
            kind: "USABILITY_HYPOTHESIS", title: "No evidence", what_happened: "x", step_refs: [], page_url: null,
            persona_impact: "", designer_action: "y", caveat: null, evidence_refs: ["Q7"], affects_criteria: [],
          },
        ],
      },
      new Set(["S5"]),
      "claude-opus-5-5",
    );
    expect(merged.checkpoints[0].verification).toBe("CONFIRMED");
    expect(merged.checkpoints[1].verification).toBe("LIMITED");
    expect(merged.journey.patterns.map((p) => p.title)).toEqual(["Typed twice"]);
    expect(merged.findings).toHaveLength(0);
    expect(merged.technicalBlockers).toEqual(report.technicalBlockers);
    expect(merged.taskOutcome).toBe("REPORTED_COMPLETE");
  });
});
