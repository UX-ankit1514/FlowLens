import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sessionStore } from "@/lib/session-store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noteSchema = z.object({
  text: z.string().trim().min(1, "Write a note first.").max(1000, "Keep notes under 1000 characters."),
});

/** POST /api/sessions/:id/notes — a designer-authored observation. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/notes">) {
  const { id } = await ctx.params;
  if (!sessionStore.get(id)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid note." }, { status: 422 });
  }
  const note = sessionStore.addNote(id, parsed.data.text);
  return NextResponse.json(note, { status: 201 });
}
