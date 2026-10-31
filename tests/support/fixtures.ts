import type { TestSession } from "@/types";

/** A session shaped like one that just finished a real TinyFish run. */
export function makeSession(result: unknown, overrides: Partial<TestSession> = {}): TestSession {
  return {
    id: "s1",
    definition: {
      id: "s1",
      websiteUrl: "https://shop.example.com",
      persona: { id: "p1", description: "Sam runs a small bakery and buys supplies online once a month." },
      goal: "Find flour in bulk and check the delivery cost.",
      successCriteria: ["Find a bulk flour product", "Find the delivery cost"],
    },
    executionStatus: "ANALYSING",
    createdAt: "2026-10-31T08:00:00.000Z",
    startedAt: "2026-10-31T08:00:02.000Z",
    events: [
      { id: "E1", sequence: 1, timestamp: "2026-10-31T08:00:00.000Z", type: "SESSION_CREATED", description: "Preparing", source: "flowlens", tone: "neutral" },
      { id: "E2", sequence: 2, timestamp: "2026-10-31T08:00:02.000Z", type: "PROVIDER_STARTED", description: "TinyFish run started", source: "provider", tone: "neutral" },
      { id: "E3", sequence: 3, timestamp: "2026-10-31T08:00:05.000Z", type: "AGENT_PROGRESS", description: "Search for bulk flour", source: "provider", tone: "neutral" },
      { id: "E4", sequence: 4, timestamp: "2026-10-31T08:00:09.000Z", type: "AGENT_PROGRESS", description: "Open the cart", source: "provider", tone: "neutral" },
    ],
    rawResult: { type: "COMPLETE", status: "COMPLETED", result, error: null },
    providerStatus: "COMPLETED",
    providerRunId: "run-1",
    liveViewStatus: "ENDED",
    steps: [
      { ref: "S1", stepId: "step-a", action: "Search for bulk flour", hasScreenshot: true },
      { ref: "S2", stepId: "step-b", action: "Open the cart", hasScreenshot: false },
    ],
    notes: [],
    cancelRequested: false,
    ...overrides,
  };
}

export const partialResult = {
  task_outcome: "partially_completed",
  outcome_summary: "Found bulk flour but could not find delivery costs before checkout.",
  final_answer: "10kg flour at $18",
  checkpoints: [
    { criterion: "Find a bulk flour product", status: "passed", observation: "10kg flour listed at $18", page_url: "https://shop.example.com/flour-10kg" },
    { criterion: "Find the delivery cost", status: "failed", observation: "No delivery cost shown in cart", page_url: "https://shop.example.com/cart" },
  ],
  actions: [
    { description: "Searched for 'bulk flour'", page_url: "https://shop.example.com/search?q=bulk+flour", result: "succeeded" },
    { description: "Clicked 'Estimate shipping'", page_url: "https://shop.example.com/help", result: "failed" },
  ],
  obstacles: [
    { kind: "information_not_found", description: "Delivery cost not shown in the cart", page_url: "https://shop.example.com/cart", blocked_progress: true },
    { kind: "unclear_navigation", description: "Two links both labelled 'Shop'", page_url: "https://shop.example.com/", blocked_progress: false },
  ],
  urls_visited: [
    "https://shop.example.com/",
    "https://shop.example.com/cart",
    "https://shop.example.com/flour-10kg",
    "https://shop.example.com/cart",
    "https://shop.example.com/",
    "https://shop.example.com/cart",
  ],
};

export const blockedResult = {
  task_outcome: "blocked",
  outcome_summary: "A CAPTCHA appeared on the first page.",
  final_answer: null,
  checkpoints: [
    { criterion: "Find a bulk flour product", status: "blocked", observation: "CAPTCHA shown" },
    { criterion: "Find the delivery cost", status: "not_verified", observation: "Not reached" },
  ],
  actions: [],
  obstacles: [{ kind: "captcha_or_bot_protection", description: "Cloudflare challenge", page_url: "https://shop.example.com/", blocked_progress: true }],
  urls_visited: ["https://shop.example.com/"],
};
