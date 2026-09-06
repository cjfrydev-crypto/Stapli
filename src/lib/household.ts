import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

const ACTIVE_HOUSEHOLD_COOKIE = "stapli_household";

export async function getHouseholds() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("household_members")
    .select("household_id, role, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (error) throw error;
  if (!memberships?.length) return [];

  const { data: households, error: householdError } = await supabase
    .from("households")
    .select("id, name, created_at")
    .in("id", memberships.map((m) => m.household_id));

  if (householdError) throw householdError;

  return (households ?? []).map((household) => ({
    ...household,
    role: memberships.find((m) => m.household_id === household.id)?.role ?? "member",
  }));
}

export async function getActiveHousehold() {
  const households = await getHouseholds();
  if (!households.length) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
  return households.find((h) => h.id === preferred) ?? households[0];
}

export async function requireHousehold() {
  const household = await getActiveHousehold();
  if (!household) redirect("/onboarding");
  return household;
}

export async function setActiveHousehold(id: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
