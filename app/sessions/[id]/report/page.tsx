import { AppShell } from "@/components/ui/AppShell";
import { UXReport } from "@/components/ux-report/UXReport";

export default async function ReportPage({ params }: PageProps<"/sessions/[id]/report">) {
  const { id } = await params;
  return (
    <AppShell maxWidth="1040px">
      <UXReport id={id} />
    </AppShell>
  );
}
