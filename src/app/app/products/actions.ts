"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/household";

export async function updateProductSettingsAction(formData: FormData) {
  const household = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const mode = String(formData.get("mode") ?? "auto") as "auto" | "manual" | "off";
  const cadenceRaw = String(formData.get("cadence") ?? "");
  const quantityRaw = String(formData.get("quantity") ?? "");
  const cadence = cadenceRaw ? Number(cadenceRaw) : null;
  const quantity = quantityRaw ? Number(quantityRaw) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("needs").update({
    prediction_mode: mode,
    manual_cadence_days: mode === "manual" && cadence && cadence > 0 ? cadence : null,
    manual_quantity: mode === "manual" && quantity && quantity > 0 ? quantity : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("household_id", household.id);
  if (error) throw error;
  revalidatePath("/app/products");
  revalidatePath("/app/upcoming");
}
