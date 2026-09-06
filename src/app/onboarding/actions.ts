"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { setActiveHousehold } from "@/lib/household";

export async function createHouseholdAction(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/onboarding?error=Give%20your%20household%20a%20name.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_household", { p_name: name });
  if (error || !data) redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Could not create household")}`);

  await setActiveHousehold(String(data));
  redirect("/app");
}

export async function acceptInviteAction(formData: FormData) {
  await requireUser();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/onboarding?error=Enter%20the%20invite%20code.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_household_invite", { p_token: token });
  if (error || !data) redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Could not accept invite")}`);

  await setActiveHousehold(String(data));
  redirect("/app");
}
