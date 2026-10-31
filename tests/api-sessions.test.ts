import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A run must never start in these tests.
const startSessionRun = vi.fn();
vi.mock("@/lib/tinyfish/runner", () => ({ startSessionRun }));

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/sessions/route");
  return POST(
    new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
};

const valid = {
  websiteUrl: "http://10.0.0.1",
  persona: "A persona",
  goal: "A goal",
  successCriteria: ["A criterion"],
};

describe("POST /api/sessions", () => {
  const original = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    startSessionRun.mockClear();
  });
  afterEach(() => {
    process.env.TINYFISH_API_KEY = original;
  });

  it("refuses to run without a server-side TinyFish key", async () => {
    delete process.env.TINYFISH_API_KEY;
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect(startSessionRun).not.toHaveBeenCalled();
  });

  it("returns inline field errors for missing inputs", async () => {
    const res = await post({ ...valid, persona: "", successCriteria: [] });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fieldErrors).toHaveProperty("persona");
    expect(body.fieldErrors).toHaveProperty("successCriteria");
    expect(startSessionRun).not.toHaveBeenCalled();
  });

  it("rejects private-network destinations", async () => {
    const res = await post(valid);
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.websiteUrl).toMatch(/private network/);
  });

  it("rejects non-JSON bodies", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });
});
