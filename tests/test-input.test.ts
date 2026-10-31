import { describe, expect, it } from "vitest";
import { collectFieldErrors, splitCriteria, suggestSessionName, testInputSchema } from "@/lib/schemas/test-input";

const valid = {
  websiteUrl: "https://example.com",
  persona: "Arjun is a 27-year-old software engineer in Bengaluru.\n\nHe prefers affordable options.",
  goal: "Find an affordable round-trip flight for a short beach vacation.",
  successCriteria: ["Find at least one flight option", "Verify its price, destination and dates"],
};

describe("test input validation", () => {
  it("accepts a complete test and leaves optional feature context out", () => {
    const parsed = testInputSchema.parse(valid);
    expect(parsed.successCriteria).toHaveLength(2);
    expect(parsed.featureContext).toBeUndefined();
  });

  it("preserves the persona exactly as supplied (only outer whitespace trimmed)", () => {
    const parsed = testInputSchema.parse({ ...valid, persona: `  ${valid.persona}  \n` });
    expect(parsed.persona).toBe(valid.persona);
  });

  it.each([
    ["persona", { ...valid, persona: "   " }],
    ["goal", { ...valid, goal: "" }],
    ["successCriteria", { ...valid, successCriteria: ["", "  "] }],
    ["websiteUrl", { ...valid, websiteUrl: "not a url" }],
    ["websiteUrl", { ...valid, websiteUrl: "http://127.0.0.1:8080" }],
  ])("blocks submission when %s is missing or invalid", (field, input) => {
    const result = testInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(collectFieldErrors(result.error)).toHaveProperty(field);
  });

  it("drops empty optional feature fields", () => {
    const parsed = testInputSchema.parse({ ...valid, featureContext: { name: "  ", description: "New fare explorer" } });
    expect(parsed.featureContext).toEqual({ description: "New fare explorer" });
  });

  it("splits success criteria one per line and strips list markers", () => {
    expect(splitCriteria("- Find pricing\n\n2) Compare plans\n• Check annual billing")).toEqual([
      "Find pricing",
      "Compare plans",
      "Check annual billing",
    ]);
  });

  it("suggests a session name from the goal", () => {
    expect(suggestSessionName("Find the pricing page. Then compare.")).toBe("Find the pricing page");
    expect(suggestSessionName("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
