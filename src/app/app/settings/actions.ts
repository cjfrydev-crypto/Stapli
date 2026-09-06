"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function createHouseholdInviteAction(formData: FormData) {
  const user = await requireUser();
  const household = await requireHousehold();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("household_invites").insert({
    household_id: household.id,
    email,
    role: "member",
    invited_by: user.id,
  }).select("token").single();
  if (error || !data) redirect(`/app/settings?error=${encodeURIComponent(error?.message ?? "Could not create invite")}`);
  redirect(`/app/settings?invite=${encodeURIComponent(data.token)}`);
}
