"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getActiveHousehold, getHouseholds, setActiveHousehold } from "@/lib/household";
import { calculateCadenceFromEvents } from "@/lib/cadence";
import { normalizeKey } from "@/lib/retailer-normalize";

export async function switchHouseholdAction(formData: FormData) {
  const id = String(formData.get("householdId") ?? "");
  const households = await getHouseholds();
  if (households.some((h) => h.id === id)) await setActiveHousehold(id);
  revalidatePath("/app", "layout");
}

export async function createTripAction(formData: FormData) {
  const user = await requireUser();
  const household = await getActiveHousehold();
  if (!household) redirect("/onboarding");
  const retailerSlug = String(formData.get("retailer") ?? "tesco");
  const plannedFor = String(formData.get("plannedFor") ?? "") || null;
  const supabase = await createClient();
  const { data: retailer } = await supabase.from("retailers").select("id, name").eq("slug", retailerSlug).single();
  if (!retailer) redirect("/app?error=Retailer%20not%20found");
  const { data: trip, error } = await supabase.from("shopping_trips").insert({ household_id: household.id, retailer_id: retailer.id, name: `Next ${retailer.name} shop`, planned_for: plannedFor, status: "active", created_by: user.id, started_at: new Date().toISOString() }).select("id").single();
  if (error || !trip) redirect(`/app?error=${encodeURIComponent(error?.message ?? "Could not create shop")}`);
  revalidatePath("/app");
  redirect("/app");
}

export async function addManualItemAction(formData: FormData) {
  const household = await getActiveHousehold();
  if (!household) redirect("/onboarding");
  const tripId = String(formData.get("tripId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const quantity = Math.max(1, Number(formData.get("quantity") ?? 1) || 1);
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  if (!name || !tripId) return;
  const supabase = await createClient();
  const normalizedKey = normalizeKey(name) || name.toLowerCase().replace(/\s+/g, "-");
  let { data: need } = await supabase.from("needs").select("id").eq("household_id", household.id).eq("normalized_key", normalizedKey).maybeSingle();
  if (!need) {
    const created = await supabase.from("needs").insert({ household_id: household.id, normalized_key: normalizedKey, name, prediction_mode: "auto" }).select("id").single();
    if (created.error || !created.data) throw created.error ?? new Error("Could not create item");
    need = created.data;
  }
  const { error } = await supabase.from("trip_items").upsert({ household_id: household.id, trip_id: tripId, need_id: need.id, category_id: categoryId, suggested_quantity: quantity, actual_quantity: quantity, status: "pending", source: "manual" }, { onConflict: "trip_id,need_id" });
  if (error) throw error;
  revalidatePath("/app");
}

export async function generateTripAction(formData: FormData) {
  const user = await requireUser();
  const household = await getActiveHousehold();
  if (!household) redirect("/onboarding");
  const retailerSlug = String(formData.get("retailer") ?? "tesco");
  const plannedDate = String(formData.get("plannedFor") ?? "") || new Date().toISOString().slice(0, 10);
  const plannedEnd = new Date(`${plannedDate}T23:59:59.999Z`);
  const supabase = await createClient();
  const [{ data: retailer }, { data: needs }, { data: events }, { data: articles }, { data: unresolved }] = await Promise.all([
    supabase.from("retailers").select("id, name").eq("slug", retailerSlug).single(),
    supabase.from("needs").select("id, name, prediction_mode, manual_cadence_days, manual_quantity, active").eq("household_id", household.id).eq("active", true),
    supabase.from("purchase_events").select("need_id, quantity, purchased_at, context, article_id").eq("household_id", household.id).gte("purchased_at", new Date(Date.now() - 370 * 86400000).toISOString()),
    supabase.from("articles").select("id, need_id, retailer_id, is_preferred, category_id").eq("household_id", household.id),
    supabase.from("trip_items").select("need_id, article_id, category_id, suggested_quantity, status, added_at").eq("household_id", household.id).in("status", ["unavailable", "deferred"]).order("added_at", { ascending: false }),
  ]);
  if (!retailer) redirect("/app/upcoming?error=Retailer%20not%20found");
  const { data: trip, error: tripError } = await supabase.from("shopping_trips").insert({ household_id: household.id, retailer_id: retailer.id, name: `Next ${retailer.name} shop`, planned_for: plannedDate, status: "active", created_by: user.id }).select("id").single();
  if (tripError || !trip) throw tripError ?? new Error("Could not create trip");
  const carryOverByNeed = new Map<string, NonNullable<typeof unresolved>[number]>();
  for (const item of unresolved ?? []) if (!carryOverByNeed.has(item.need_id)) carryOverByNeed.set(item.need_id, item);
  const rowsByNeed = new Map<string, { household_id: string; trip_id: string; need_id: string; article_id: string | null; category_id: string | null; suggested_quantity: number; actual_quantity: number; status: "pending"; source: "predicted" | "carry_over"; }>();
  for (const item of carryOverByNeed.values()) {
    const satisfiedLater = (events ?? []).some((event) => event.need_id === item.need_id && new Date(event.purchased_at).getTime() > new Date(item.added_at).getTime());
    if (satisfiedLater) continue;
    const preferred = (articles ?? []).find((a) => a.need_id === item.need_id && a.retailer_id === retailer.id && a.is_preferred) ?? (articles ?? []).find((a) => a.need_id === item.need_id && a.retailer_id === retailer.id);
    const quantity = Number(item.suggested_quantity) || 1;
    rowsByNeed.set(item.need_id, { household_id: household.id, trip_id: trip.id, need_id: item.need_id, article_id: preferred?.id ?? item.article_id ?? null, category_id: preferred?.category_id ?? item.category_id ?? null, suggested_quantity: quantity, actual_quantity: quantity, status: "pending", source: "carry_over" });
  }
  for (const need of needs ?? []) {
    if (need.prediction_mode === "off" || rowsByNeed.has(need.id)) continue;
    const needEvents = (events ?? []).filter((event) => event.need_id === need.id);
    const preferred = (articles ?? []).find((a) => a.need_id === need.id && a.retailer_id === retailer.id && a.is_preferred) ?? (articles ?? []).find((a) => a.need_id === need.id && a.retailer_id === retailer.id);
    const stats = calculateCadenceFromEvents(need, needEvents, { quantityArticleId: preferred?.id });
    if (need.prediction_mode === "auto" && stats.totalPurchaseCount < 4) continue;
    if (!stats.nextExpectedAt || new Date(stats.nextExpectedAt) > plannedEnd) continue;
    const quantity = Math.max(1, Math.round((stats.effectiveQuantity ?? 1) * 100) / 100);
    rowsByNeed.set(need.id, { household_id: household.id, trip_id: trip.id, need_id: need.id, article_id: preferred?.id ?? null, category_id: preferred?.category_id ?? null, suggested_quantity: quantity, actual_quantity: quantity, status: "pending", source: "predicted" });
  }
  const rows = [...rowsByNeed.values()];
  if (rows.length) {
    const { error } = await supabase.from("trip_items").insert(rows);
    if (error) throw error;
  }
  revalidatePath("/app");
  redirect("/app");
}

export async function completeTripAction(formData: FormData) {
  const household = await getActiveHousehold();
  if (!household) return;
  const tripId = String(formData.get("tripId") ?? "");
  const supabase = await createClient();
  const { error: deferError } = await supabase.from("trip_items").update({ status: "deferred", completed_at: new Date().toISOString() }).eq("trip_id", tripId).eq("household_id", household.id).eq("status", "pending");
  if (deferError) throw deferError;
  const { error } = await supabase.from("shopping_trips").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", tripId).eq("household_id", household.id);
  if (error) throw error;
  revalidatePath("/app");
}

export async function clearActiveHouseholdCookieAction() {
  const cookieStore = await cookies();
  cookieStore.delete("stapli_household");
}
