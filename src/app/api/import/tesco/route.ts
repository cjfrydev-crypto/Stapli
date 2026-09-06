import { createHash } from "node:crypto";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth";
import { getActiveHousehold } from "@/lib/household";
import { inferNeed } from "@/lib/retailer-normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

type TescoItem = {
  name?: string;
  quantity?: number;
  weight?: number;
  price?: number;
  volume?: number;
};

type TescoPurchase = {
  timestamp?: string;
  type?: string;
  items?: TescoItem[];
};

type TescoExport = {
  requestId?: string;
  purchases?: TescoPurchase[];
};

type RawLine = {
  transactionAt: string;
  transactionType: string;
  articleName: string;
  quantity: number;
  price: number | null;
  weight: number | null;
  volume: number | null;
  fingerprint: string;
  raw: TescoItem;
};

type Family = {
  key: string;
  name: string;
  category: string;
  occurrences: Map<string, { quantity: number; lines: RawLine[] }>;
  articleNames: Set<string>;
};

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function toIso(timestamp: string) {
  const normalized = timestamp.trim().replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Tesco timestamp: ${timestamp}`);
  return parsed.toISOString();
}

async function parseUpload(file: File): Promise<TescoExport> {
  const bytes = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip")) {
    const zip = await JSZip.loadAsync(bytes);
    const jsonEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".json"));
    if (!jsonEntry) throw new Error("No JSON file found inside this Tesco export.");
    return JSON.parse(await jsonEntry.async("text")) as TescoExport;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as TescoExport;
}

function buildRawLines(purchases: TescoPurchase[]) {
  const lines: RawLine[] = [];
  purchases.forEach((purchase) => {
    if (!purchase.timestamp) return;
    const transactionAt = toIso(purchase.timestamp);
    (purchase.items ?? []).forEach((item, itemIndex) => {
      const articleName = String(item.name ?? "").trim();
      const quantity = Number(item.quantity ?? 0);
      if (!articleName || quantity <= 0) return;
      if (/paid plan for clubcardplus/i.test(articleName)) return;
      const fingerprint = hash([
        purchase.timestamp,
        purchase.type ?? "",
        articleName,
        quantity,
        item.price ?? "",
        item.weight ?? "",
        item.volume ?? "",
        itemIndex,
      ].join("|"));
      lines.push({
        transactionAt,
        transactionType: purchase.type ?? "UNKNOWN",
        articleName,
        quantity,
        price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
        weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : null,
        volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : null,
        fingerprint,
        raw: item,
      });
    });
  });
  return lines;
}

function buildFamilies(lines: RawLine[]) {
  const families = new Map<string, Family>();
  for (const line of lines) {
    const normalized = inferNeed(line.articleName);
    let family = families.get(normalized.key);
    if (!family) {
      family = { ...normalized, occurrences: new Map(), articleNames: new Set() };
      families.set(normalized.key, family);
    }
    family.articleNames.add(line.articleName);
    const occurrence = family.occurrences.get(line.transactionAt) ?? { quantity: 0, lines: [] };
    occurrence.quantity += line.quantity;
    occurrence.lines.push(line);
    family.occurrences.set(line.transactionAt, occurrence);
  }
  return [...families.values()].filter((family) => family.occurrences.size >= 2);
}

function chunks<T>(items: T[], size = 400) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export async function POST(request: Request) {
  let importId: string | null = null;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const household = await getActiveHousehold();
  if (!household) return NextResponse.json({ error: "Create or join a household first." }, { status: 400 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a Tesco ZIP or JSON export." }, { status: 400 });

    const payload = await parseUpload(file);
    if (!Array.isArray(payload.purchases)) throw new Error("This does not look like a Tesco transaction export.");
    const lines = buildRawLines(payload.purchases);
    const families = buildFamilies(lines);
    const supabase = await createClient();

    const { data: tesco, error: retailerError } = await supabase.from("retailers").select("id").eq("slug", "tesco").single();
    if (retailerError || !tesco) throw retailerError ?? new Error("Tesco retailer is not configured.");

    if (payload.requestId) {
      const { data: existing } = await supabase
        .from("retailer_imports")
        .select("id, transaction_count, line_count, imported_at")
        .eq("household_id", household.id)
        .eq("retailer_id", tesco.id)
        .eq("source_request_id", payload.requestId)
        .maybeSingle();
      if (existing) return NextResponse.json({ ok: true, alreadyImported: true, ...existing });
    }

    const { data: importRecord, error: importError } = await supabase.from("retailer_imports").insert({
      household_id: household.id,
      retailer_id: tesco.id,
      source_filename: file.name,
      source_request_id: payload.requestId ?? null,
      status: "processing",
      transaction_count: payload.purchases.length,
      line_count: lines.length,
      imported_by: user.id,
    }).select("id").single();
    if (importError || !importRecord) throw importError ?? new Error("Could not create import record.");
    importId = importRecord.id;

    for (const batch of chunks(lines, 350)) {
      const { error } = await supabase.from("retailer_import_lines").upsert(batch.map((line) => ({
        import_id: importRecord.id,
        household_id: household.id,
        retailer_id: tesco.id,
        transaction_at: line.transactionAt,
        transaction_type: line.transactionType,
        article_name: line.articleName,
        quantity: line.quantity,
        price: line.price,
        weight: line.weight,
        volume: line.volume,
        fingerprint: line.fingerprint,
        raw: line.raw,
      })), { onConflict: "household_id,fingerprint", ignoreDuplicates: true });
      if (error) throw error;
    }

    const { data: categories } = await supabase
      .from("store_categories")
      .select("id, name")
      .eq("household_id", household.id)
      .is("retailer_id", null);
    const categoryIds = new Map((categories ?? []).map((category) => [category.name, category.id]));

    const familyKeys = families.map((family) => family.key);
    const existingNeeds: { id: string; normalized_key: string; name: string }[] = [];
    for (const batch of chunks(familyKeys, 400)) {
      const { data, error } = await supabase.from("needs").select("id, normalized_key, name").eq("household_id", household.id).in("normalized_key", batch);
      if (error) throw error;
      existingNeeds.push(...(data ?? []));
    }
    const existingKeySet = new Set(existingNeeds.map((need) => need.normalized_key));
    const missingNeeds = families.filter((family) => !existingKeySet.has(family.key));
    for (const batch of chunks(missingNeeds, 300)) {
      const { error } = await supabase.from("needs").insert(batch.map((family) => ({
        household_id: household.id,
        normalized_key: family.key,
        name: family.name,
        prediction_mode: "auto",
        unit: "item",
      })));
      if (error) throw error;
    }

    const allNeeds: { id: string; normalized_key: string; name: string }[] = [];
    for (const batch of chunks(familyKeys, 400)) {
      const { data, error } = await supabase.from("needs").select("id, normalized_key, name").eq("household_id", household.id).in("normalized_key", batch);
      if (error) throw error;
      allNeeds.push(...(data ?? []));
    }
    const needByKey = new Map(allNeeds.map((need) => [need.normalized_key, need]));

    const articleRows = families.flatMap((family) => {
      const need = needByKey.get(family.key);
      if (!need) return [];
      return [...family.articleNames].map((articleName) => ({
        household_id: household.id,
        need_id: need.id,
        retailer_id: tesco.id,
        name: articleName,
        category_id: categoryIds.get(family.category) ?? categoryIds.get("Other") ?? null,
        is_preferred: false,
      }));
    });
    for (const batch of chunks(articleRows, 300)) {
      const { error } = await supabase.from("articles").upsert(batch, { onConflict: "household_id,retailer_id,name" });
      if (error) throw error;
    }

    const { data: allArticles, error: articleError } = await supabase
      .from("articles")
      .select("id, need_id, name")
      .eq("household_id", household.id)
      .eq("retailer_id", tesco.id);
    if (articleError) throw articleError;
    const articleByName = new Map((allArticles ?? []).map((article) => [article.name, article]));

    const eventRows = families.flatMap((family) => {
      const need = needByKey.get(family.key);
      if (!need) return [];
      return [...family.occurrences.entries()].map(([transactionAt, occurrence]) => {
        const topLine = [...occurrence.lines].sort((a, b) => b.quantity - a.quantity)[0];
        const article = articleByName.get(topLine.articleName);
        const totalPrice = occurrence.lines.reduce((sum, line) => sum + (line.price ?? 0) * line.quantity, 0);
        return {
          household_id: household.id,
          need_id: need.id,
          article_id: article?.id ?? null,
          retailer_id: tesco.id,
          quantity: occurrence.quantity,
          purchased_at: transactionAt,
          unit_price: topLine.price,
          total_price: totalPrice || null,
          context: "imported" as const,
          source_reference: `tesco:${hash(`${transactionAt}|${family.key}`)}`,
        };
      });
    });
    for (const batch of chunks(eventRows, 300)) {
      const { error } = await supabase.from("purchase_events").upsert(batch, { onConflict: "household_id,source_reference" });
      if (error) throw error;
    }

    const cutoff = Date.now() - 16 * 7 * 86_400_000;
    const preferredIds: string[] = [];
    for (const family of families) {
      const need = needByKey.get(family.key);
      if (!need) continue;
      const scores = new Map<string, { count: number; latest: number }>();
      for (const [transactionAt, occurrence] of family.occurrences) {
        const ts = new Date(transactionAt).getTime();
        if (ts < cutoff) continue;
        const seen = new Set<string>();
        for (const line of occurrence.lines) {
          if (seen.has(line.articleName)) continue;
          seen.add(line.articleName);
          const score = scores.get(line.articleName) ?? { count: 0, latest: 0 };
          score.count += 1;
          score.latest = Math.max(score.latest, ts);
          scores.set(line.articleName, score);
        }
      }
      const bestName = [...scores.entries()].sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)[0]?.[0]
        ?? [...family.articleNames][0];
      const preferred = articleByName.get(bestName);
      if (preferred) preferredIds.push(preferred.id);
    }
    await supabase.from("articles").update({ is_preferred: false }).eq("household_id", household.id).eq("retailer_id", tesco.id);
    for (const batch of chunks(preferredIds, 300)) {
      if (batch.length) {
        const { error } = await supabase.from("articles").update({ is_preferred: true }).in("id", batch);
        if (error) throw error;
      }
    }

    const { error: readyError } = await supabase.from("retailer_imports").update({ status: "ready" }).eq("id", importRecord.id);
    if (readyError) throw readyError;

    return NextResponse.json({
      ok: true,
      importId: importRecord.id,
      transactions: payload.purchases.length,
      lines: lines.length,
      recurringNeeds: families.length,
      purchaseEvents: eventRows.length,
    });
  } catch (error) {
    if (importId) {
      try {
        const supabase = await createClient();
        await supabase.from("retailer_imports").update({ status: "failed" }).eq("id", importId);
      } catch {
      }
    }
    const message = error instanceof Error ? error.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
