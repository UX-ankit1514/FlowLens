import type { Metadata } from "next";
import { AppShell } from "@/components/ui/AppShell";
import { TestSetup } from "@/components/test-setup/TestSetup";

export const metadata: Metadata = {
  title: "New test — FlowLens",
};

export default async function SetupPage({ searchParams }: PageProps<"/new">) {
  const { from } = await searchParams;
  return (
    <AppShell>
      <TestSetup fromSessionId={typeof from === "string" ? from : undefined} />
    </AppShell>
  );
}
