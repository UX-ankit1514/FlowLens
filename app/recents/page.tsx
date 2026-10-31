import { cookies, headers } from "next/headers";
import { AppShell } from "@/components/ui/AppShell";
import { RecentSessions } from "@/components/recents/RecentSessions";
import { isHosted, resolveKeys } from "@/lib/keys";
import { listRecentSessions } from "@/lib/sessions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RecentsPage() {
  const keys = resolveKeys(await headers(), await cookies());
  const sessions = await listRecentSessions(keys);
  return (
    <AppShell>
      <RecentSessions sessions={sessions} hosted={isHosted()} connected={Boolean(keys.tinyfish)} />
    </AppShell>
  );
}
