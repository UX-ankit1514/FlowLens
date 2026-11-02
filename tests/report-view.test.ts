import { describe, expect, it } from "vitest";
import { bySeverity, findingSeverity, humanizeRefs, refName, stepTone, tokenizeRefs } from "@/lib/presentation/report-view";
import type { Checkpoint, JourneyStep, UXFinding } from "@/types";

const checkpoint = (id: string, status: Checkpoint["status"]): Checkpoint => ({
  id,
  description: `Criterion ${id}`,
  status,
  evidenceRefs: [id],
  verification: "NOT_APPLICABLE",
  verificationRefs: [],
});

const finding = (id: string, over: Partial<UXFinding> = {}): UXFinding => ({
  id,
  kind: "USABILITY_HYPOTHESIS",
  title: id,
  whatHappened: "",
  stepRefs: [],
  designerAction: "",
  evidenceRefs: [],
  affectsCriteria: [],
  origin: "RULES",
  ...over,
});

const checkpoints = [checkpoint("C1", "PASSED"), checkpoint("C2", "FAILED"), checkpoint("C3", "BLOCKED")];

describe("finding severity", () => {
  it("is high when the issue cost a success criterion", () => {
    expect(findingSeverity(finding("F1", { affectsCriteria: ["C2"] }), checkpoints)).toBe("HIGH");
    expect(findingSeverity(finding("F1", { affectsCriteria: ["C3"] }), checkpoints)).toBe("HIGH");
  });

  it("is medium when something broke or slowed a criterion that was still met", () => {
    expect(findingSeverity(finding("F1", { kind: "FUNCTIONAL_FAILURE" }), checkpoints)).toBe("MEDIUM");
    expect(findingSeverity(finding("F1", { affectsCriteria: ["C1"] }), checkpoints)).toBe("MEDIUM");
  });

  it("is low otherwise, and ignores criteria the report doesn't hold", () => {
    expect(findingSeverity(finding("F1"), checkpoints)).toBe("LOW");
    expect(findingSeverity(finding("F1", { affectsCriteria: ["C9"] }), checkpoints)).toBe("MEDIUM");
  });

  it("sorts most severe first and keeps report order within a level", () => {
    const ranked = bySeverity(
      [finding("F1"), finding("F2", { affectsCriteria: ["C2"] }), finding("F3", { kind: "FUNCTIONAL_FAILURE" }), finding("F4", { affectsCriteria: ["C3"] })],
      checkpoints,
    );
    expect(ranked.map((r) => r.finding.id)).toEqual(["F2", "F4", "F3", "F1"]);
  });
});

describe("evidence references in plain language", () => {
  const known = (ref: string) => ["S16", "S21", "S27", "C2", "O1"].includes(ref);

  it("names references", () => {
    expect(refName("S16")).toBe("Step 16");
    expect(refName("C2")).toBe("Criterion 2");
    expect(refName("O1")).toBe("Obstacle 1");
    expect(refName("weird")).toBe("weird");
  });

  it("links only references the report holds", () => {
    const tokens = tokenizeRefs("Stuck at S16 and S99 on an A4 form; C2 wasn't met.", known);
    expect(tokens).toEqual([
      { text: "Stuck at " },
      { ref: "S16", label: "Step 16" },
      { text: " and S99 on an A4 form; " },
      { ref: "C2", label: "Criterion 2" },
      { text: " wasn't met." },
    ]);
  });

  it("reads ranges naturally", () => {
    expect(humanizeRefs("The agent continued after S27–S28.", known)).toBe("The agent continued after steps 27–28.");
    expect(humanizeRefs("(S16, S21)", known)).toBe("(step 16, step 21)");
  });
});

describe("journey strip tones", () => {
  const step = (over: Partial<JourneyStep>): JourneyStep => ({
    ref: "S1",
    number: 1,
    statedPurpose: "Do something",
    actionType: "CLICK",
    hasScreenshot: true,
    flags: [],
    ...over,
  });

  it("marks struggle, errors and test-setup problems differently", () => {
    expect(stepTone(step({}))).toBe("smooth");
    expect(stepTone(step({ flags: [{ kind: "RETRY", note: "", relatedRefs: [] }] }))).toBe("friction");
    expect(stepTone(step({ flags: [{ kind: "ERROR", note: "", relatedRefs: [] }] }))).toBe("error");
    expect(stepTone(step({ flags: [{ kind: "TECHNICAL", note: "", relatedRefs: [] }, { kind: "RETRY", note: "", relatedRefs: [] }] }))).toBe("setup");
    expect(stepTone(step({ terminal: "COMPLETED" }))).toBe("end");
  });
});
