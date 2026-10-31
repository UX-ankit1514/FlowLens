import { AppShell } from "@/components/ui/AppShell";
import { LiveSession } from "@/components/live-session/LiveSession";

export default async function LiveSessionPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  return (
    <AppShell maxWidth="1440px">
      <LiveSession id={id} />
    </AppShell>
  );
}
