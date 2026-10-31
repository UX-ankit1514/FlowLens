import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { collectFieldErrors, suggestSessionName, testInputSchema } from "@/lib/schemas/test-input";
import { validatePublicWebsite } from "@/lib/security/dns";
import { sessionStore } from "@/lib/session-store/store";
import { recentSummaryOf } from "@/lib/session-store/snapshot";
import { isTinyFishConfigured } from "@/lib/tinyfish/client";
import { startSessionRun } from "@/lib/tinyfish/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions — newest-first local history for the Recents screen. */
export async function GET() {
  return NextResponse.json(sessionStore.listRecent().map(recentSummaryOf), {
    headers: { "Cache-Control": "no-store" },
  });
}

/** POST /api/sessions — validate a test definition and start a real TinyFish run. */
export async function POST(request: NextRequest) {
  if (!isTinyFishConfigured()) {
    return NextResponse.json(
      { error: "TINYFISH_API_KEY is not set on the server. Add it to .env.local and restart FlowLens." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = testInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some fields need attention.", fieldErrors: collectFieldErrors(parsed.error) },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const destination = await validatePublicWebsite(input.websiteUrl);
  if (!destination.ok) {
    return NextResponse.json(
      { error: destination.reason, fieldErrors: { websiteUrl: destination.reason } },
      { status: 422 },
    );
  }

  const featureContext =
    input.featureContext && Object.values(input.featureContext).some(Boolean) ? input.featureContext : undefined;

  const session = sessionStore.create({
    websiteUrl: destination.url,
    sessionName: input.sessionName ?? suggestSessionName(input.goal),
    persona: { id: randomUUID(), description: input.persona },
    goal: input.goal,
    successCriteria: input.successCriteria,
    featureContext,
  });

  startSessionRun(session.id);

  return NextResponse.json({ id: session.id }, { status: 201 });
}
