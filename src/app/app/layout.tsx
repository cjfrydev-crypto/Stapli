import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { AppShell } from "@/components/app-shell";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const household = await requireHousehold();
  return <AppShell householdName={household.name}>{children}</AppShell>;
}
