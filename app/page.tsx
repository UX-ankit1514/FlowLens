import { AppShell } from "@/components/ui/AppShell";
import { TestSetup } from "@/components/test-setup/TestSetup";

export default async function SetupPage({ searchParams }: PageProps<"/">) {
  const { from } = await searchParams;
  return (
    <AppShell>
      <TestSetup fromSessionId={typeof from === "string" ? from : undefined} />
    </AppShell>
  );
}
