import { AppShell } from "@/components/ui/AppShell";
import { RecentSessions } from "@/components/recents/RecentSessions";
import { recentSummaryOf } from "@/lib/session-store/snapshot";
import { sessionStore } from "@/lib/session-store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function RecentsPage() {
  const sessions = sessionStore.listRecent().map(recentSummaryOf);
  return (
    <AppShell>
      <RecentSessions sessions={sessions} />
    </AppShell>
  );
}
