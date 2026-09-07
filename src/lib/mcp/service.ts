import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inferCategory, normalizeKey } from "@/lib/retailer-normalize";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

type JsonObject = Record<string, unknown>;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: JsonObject;
  isError?: boolean;
};

type AuthContext = {
  userId: string;
  expiresAt: number;
  clientId?: string;
  supabase: SupabaseClient;
};

type Household = { id: string; name: string; role: string };
type Trip = {
  id: string;
  household_id: string;
  retailer_id: string | null;
  name: string | null;
  status: string;
  planned_for: string | null;
  created_at: string;
};

type Need = {
  id: string;
  household_id: string;
  name: string;
  normalized_key: string;
  prediction_mode: string;
  manual_cadence_days: number | null;
  manual_quantity: number | null;
  unit: string;
  notes: string | null;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function textResult(data: JsonObject): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function errorResult(message: string, details?: unknown): ToolResult {
  const data: JsonObject = { error: message, details: details ?? null };
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: true };
}

function stringArg(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jwtPayload(token: string): JsonObject | null {
  try {
    const body = token.split(".")[1];
    return body ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JsonObject : null;
  } catch {
    return null;
  }
}

export async function authenticateMcpToken(token: string): Promise<AuthContext | null> {
  const verifier = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) return null;

  const claims = jwtPayload(token);
  const exp = typeof claims?.exp === "number" ? claims.exp : 0;
  const issuer = typeof claims?.iss === "string" ? claims.iss : "";
  const audience = claims?.aud;
  const audienceOk = audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated"));
  if (exp <= Math.floor(Date.now() / 1000) || issuer !== `${SUPABASE_URL}/auth/v1` || !audienceOk) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    userId: data.user.id,
    expiresAt: exp,
    clientId: typeof claims?.client_id === "string" ? claims.client_id : undefined,
    supabase,
  };
}

async function householdsFor(auth: AuthContext): Promise<Household[]> {
  const { data: memberships, error } = await auth.supabase
    .from("household_members")
    .select("household_id, role, joined_at")
    .eq("user_id", auth.userId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  if (!memberships?.length) return [];

  const { data: households, error: householdError } = await auth.supabase
    .from("households")
    .select("id, name")
    .in("id", memberships.map((row) => String(row.household_id)));
  if (householdError) throw householdError;

  return (households ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: String(memberships.find((membership) => membership.household_id === row.id)?.role ?? "member"),
  }));
}

async function resolveHousehold(auth: AuthContext, requested?: string): Promise<Household> {
  const households = await householdsFor(auth);
  if (!households.length) throw new Error("This Stapli account does not have a household yet.");
  if (requested) {
    const household = households.find((row) => row.id === requested);
    if (!household) throw new Error("That household is not available to this user.");
    return household;
  }
  if (households.length > 1) throw new Error("This user belongs to multiple households. Pass household_id explicitly.");
  return households[0];
}

async function resolveRetailer(auth: AuthContext, retailer?: string) {
  if (!retailer) return null;
  const slug = normalizeKey(retailer);
  const bySlug = await auth.supabase.from("retailers").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (bySlug.error) throw bySlug.error;
  if (bySlug.data) return bySlug.data;
  const byName = await auth.supabase.from("retailers").select("id, slug, name").ilike("name", retailer).maybeSingle();
  if (byName.error) throw byName.error;
  if (byName.data) return byName.data;
  throw new Error(`Retailer '${retailer}' is not configured in Stapli.`);
}

async function currentTrip(auth: AuthContext, householdId: string): Promise<Trip | null> {
  const { data, error } = await auth.supabase
    .from("shopping_trips")
    .select("id, household_id, retailer_id, name, status, planned_for, created_at")
    .eq("household_id", householdId)
    .in("status", ["active", "planning"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []) as Trip[];
  return rows.find((row) => row.status === "active") ?? rows[0] ?? null;
}

async function resolveTrip(auth: AuthContext, householdId: string, tripId?: string): Promise<Trip | null> {
  if (!tripId) return currentTrip(auth, householdId);
  const { data, error } = await auth.supabase
    .from("shopping_trips")
    .select("id, household_id, retailer_id, name, status, planned_for, created_at")
    .eq("household_id", householdId)
    .eq("id", tripId)
    .maybeSingle();
  if (error) throw error;
  return data as Trip | null;
}

function objectMap(rows: unknown[] | null | undefined) {
  const map = new Map<string, JsonObject>();
  for (const raw of rows ?? []) {
    const row = asObject(raw);
    if (typeof row.id === "string") map.set(row.id, row);
  }
  return map;
}

async function getList(auth: AuthContext, householdId: string, trip: Trip) {
  const { data: items, error } = await auth.supabase
    .from("trip_items")
    .select("id, need_id, article_id, suggested_quantity, actual_quantity, status, source, note, sort_order, added_at")
    .eq("household_id", householdId)
    .eq("trip_id", trip.id)
    .order("sort_order", { ascending: true })
    .order("added_at", { ascending: true });
  if (error) throw error;

  const needIds = [...new Set((items ?? []).map((row) => String(row.need_id)))];
  const articleIds = [...new Set((items ?? []).flatMap((row) => row.article_id ? [String(row.article_id)] : []))];

  const needsResponse = needIds.length
    ? await auth.supabase.from("needs").select("id, name, unit, prediction_mode, manual_quantity, manual_cadence_days, notes").in("id", needIds)
    : { data: [], error: null };
  if (needsResponse.error) throw needsResponse.error;
  const articlesResponse = articleIds.length
    ? await auth.supabase.from("articles").select("id, name, brand, pack_size, retailer_id, need_id, is_preferred").in("id", articleIds)
    : { data: [], error: null };
  if (articlesResponse.error) throw articlesResponse.error;
  const retailerResponse = trip.retailer_id
    ? await auth.supabase.from("retailers").select("id, name, slug").eq("id", trip.retailer_id).maybeSingle()
    : { data: null, error: null };
  if (retailerResponse.error) throw retailerResponse.error;

  const needs = objectMap(needsResponse.data as unknown[]);
  const articles = objectMap(articlesResponse.data as unknown[]);

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      status: trip.status,
      planned_for: trip.planned_for,
      retailer: retailerResponse.data?.name ?? null,
    },
    items: (items ?? []).map((row) => ({
      id: row.id,
      need: needs.get(String(row.need_id))?.name ?? "Unknown item",
      article: row.article_id ? articles.get(String(row.article_id))?.name ?? null : null,
      suggested_quantity: Number(row.suggested_quantity),
      actual_quantity: row.actual_quantity == null ? null : Number(row.actual_quantity),
      status: row.status,
      source: row.source,
      note: row.note,
    })),
  };
}

async function ensureNeed(auth: AuthContext, householdId: string, name: string): Promise<Need> {
  const key = normalizeKey(name) || name.trim().toLowerCase().replace(/\s+/g, "-");
  const fields = "id, household_id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes";
  const existing = await auth.supabase.from("needs").select(fields).eq("household_id", householdId).eq("normalized_key", key).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as Need;

  const created = await auth.supabase
    .from("needs")
    .insert({ household_id: householdId, name: name.trim(), normalized_key: key, prediction_mode: "auto", unit: "item" })
    .select(fields)
    .single();
  if (!created.error) return created.data as Need;

  const raced = await auth.supabase.from("needs").select(fields).eq("household_id", householdId).eq("normalized_key", key).single();
  if (raced.error) throw created.error;
  return raced.data as Need;
}

async function preferredArticle(auth: AuthContext, householdId: string, needId: string, retailerId: string | null) {
  let request = auth.supabase
    .from("articles")
    .select("id, name, brand, pack_size, retailer_id, is_preferred")
    .eq("household_id", householdId)
    .eq("need_id", needId);
  if (retailerId) request = request.eq("retailer_id", retailerId);
  const { data, error } = await request.order("is_preferred", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export const TOOL_DEFINITIONS = [
  {
    name: "list_households",
    title: "List Stapli households",
    description: "List households this signed-in Stapli user can access. Use when household context is ambiguous.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_current_list",
    title: "Get current shopping list",
    description: "Read the active or planning shopping list with quantities and exact products when known.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, trip_id: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "search_items",
    title: "Search known shopping items",
    description: "Search household needs and retailer articles before inventing a new shopping item.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, query: { type: "string", minLength: 1 }, limit: { type: "number", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_purchase_history",
    title: "Get purchase history",
    description: "Read recent actual purchases. Stapli returns facts; the AI should reason over them.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, days: { type: "number", minimum: 1, maximum: 3650 }, query: { type: "string" }, retailer: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 300 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_shopping_rules",
    title: "Get household shopping rules",
    description: "Read natural-language household shopping preferences and standing instructions.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, include_inactive: { type: "boolean" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "create_shopping_list",
    title: "Create shopping list",
    description: "Create a shopping trip/list for a retailer or date. Avoid duplicate lists.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, retailer: { type: "string" }, name: { type: "string" }, planned_for: { type: "string", description: "YYYY-MM-DD" } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "add_to_list",
    title: "Add items to shopping list",
    description: "Add household needs to a list. Existing items on the same list are updated rather than duplicated.",
    inputSchema: {
      type: "object",
      properties: {
        household_id: { type: "string" }, trip_id: { type: "string" },
        items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", properties: { name: { type: "string", minLength: 1 }, quantity: { type: "number", exclusiveMinimum: 0 }, note: { type: "string" } }, required: ["name"], additionalProperties: false } },
      },
      required: ["items"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_list_item",
    title: "Update shopping list item",
    description: "Change quantity, note or outcome. Bought status records an actual purchase transaction.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, item_id: { type: "string" }, quantity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] }, status: { type: "string", enum: ["pending", "bought", "unavailable", "not_needed", "deferred"] } }, required: ["item_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "remove_from_list",
    title: "Remove shopping list item",
    description: "Remove an unpurchased list item. Purchased items are retained as history.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, item_id: { type: "string" } }, required: ["item_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "save_shopping_rule",
    title: "Save shopping rule",
    description: "Save a standing natural-language household shopping instruction.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, instruction: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["instruction"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "remove_shopping_rule",
    title: "Remove shopping rule",
    description: "Deactivate a standing shopping rule while retaining its history.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, rule_id: { type: "string" } }, required: ["rule_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
] as const;

export async function callStapliTool(auth: AuthContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const input = asObject(rawInput);
  try {
    if (name === "list_households") return textResult({ households: await householdsFor(auth) });

    const household = await resolveHousehold(auth, stringArg(input, "household_id"));

    if (name === "get_current_list") {
      const trip = await resolveTrip(auth, household.id, stringArg(input, "trip_id"));
      if (!trip) return textResult({ household, trip: null, items: [], message: "There is no active or planning shopping list yet." });
      return textResult({ household, ...(await getList(auth, household.id, trip)) });
    }

    if (name === "search_items") {
      const query = stringArg(input, "query");
      if (!query) return errorResult("query is required");
      const limit = Math.min(50, Math.max(1, numberArg(input, "limit") ?? 20));
      const needs = await auth.supabase
        .from("needs")
        .select("id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes")
        .eq("household_id", household.id)
        .ilike("name", `%${query}%`)
        .limit(limit);
      if (needs.error) throw needs.error;
      const articles = await auth.supabase
        .from("articles")
        .select("id, need_id, retailer_id, name, brand, pack_size, is_preferred, last_price, currency")
        .eq("household_id", household.id)
        .ilike("name", `%${query}%`)
        .limit(limit);
      if (articles.error) throw articles.error;
      const retailerIds = [...new Set((articles.data ?? []).map((row) => String(row.retailer_id)))];
      const retailerResponse = retailerIds.length ? await auth.supabase.from("retailers").select("id, name, slug").in("id", retailerIds) : { data: [], error: null };
      if (retailerResponse.error) throw retailerResponse.error;
      const retailers = objectMap(retailerResponse.data as unknown[]);
      return textResult({
        household,
        needs: needs.data ?? [],
        articles: (articles.data ?? []).map((row) => ({ ...row, retailer: retailers.get(String(row.retailer_id))?.name ?? null })),
      });
    }

    if (name === "get_purchase_history") {
      const days = Math.min(3650, Math.max(1, numberArg(input, "days") ?? 120));
      const limit = Math.min(300, Math.max(1, numberArg(input, "limit") ?? 150));
      const query = stringArg(input, "query")?.toLowerCase();
      const retailer = await resolveRetailer(auth, stringArg(input, "retailer"));
      let request = auth.supabase
        .from("purchase_events")
        .select("id, need_id, article_id, retailer_id, quantity, unit_price, total_price, purchased_at, context")
        .eq("household_id", household.id)
        .gte("purchased_at", new Date(Date.now() - days * 86400000).toISOString())
        .order("purchased_at", { ascending: false })
        .limit(limit);
      if (retailer) request = request.eq("retailer_id", retailer.id);
      const purchases = await request;
      if (purchases.error) throw purchases.error;

      const needIds = [...new Set((purchases.data ?? []).map((row) => String(row.need_id)))];
      const articleIds = [...new Set((purchases.data ?? []).flatMap((row) => row.article_id ? [String(row.article_id)] : []))];
      const retailerIds = [...new Set((purchases.data ?? []).flatMap((row) => row.retailer_id ? [String(row.retailer_id)] : []))];
      const needsResponse = needIds.length ? await auth.supabase.from("needs").select("id, name").in("id", needIds) : { data: [], error: null };
      const articlesResponse = articleIds.length ? await auth.supabase.from("articles").select("id, name").in("id", articleIds) : { data: [], error: null };
      const retailersResponse = retailerIds.length ? await auth.supabase.from("retailers").select("id, name").in("id", retailerIds) : { data: [], error: null };
      if (needsResponse.error) throw needsResponse.error;
      if (articlesResponse.error) throw articlesResponse.error;
      if (retailersResponse.error) throw retailersResponse.error;
      const needs = objectMap(needsResponse.data as unknown[]);
      const articles = objectMap(articlesResponse.data as unknown[]);
      const retailers = objectMap(retailersResponse.data as unknown[]);
      const mapped = (purchases.data ?? []).map((row) => ({
        purchased_at: row.purchased_at,
        need: needs.get(String(row.need_id))?.name ?? null,
        article: row.article_id ? articles.get(String(row.article_id))?.name ?? null : null,
        retailer: row.retailer_id ? retailers.get(String(row.retailer_id))?.name ?? null : null,
        quantity: Number(row.quantity),
        unit_price: row.unit_price == null ? null : Number(row.unit_price),
        total_price: row.total_price == null ? null : Number(row.total_price),
        context: row.context,
      })).filter((row) => !query || String(row.need ?? "").toLowerCase().includes(query) || String(row.article ?? "").toLowerCase().includes(query));
      return textResult({ household, period_days: days, purchases: mapped });
    }

    if (name === "get_shopping_rules") {
      let request = auth.supabase.from("shopping_rules").select("id, instruction, active, created_at, updated_at").eq("household_id", household.id).order("created_at", { ascending: true });
      if (input.include_inactive !== true) request = request.eq("active", true);
      const result = await request;
      if (result.error) throw result.error;
      return textResult({ household, rules: result.data ?? [] });
    }

    if (name === "create_shopping_list") {
      const retailer = await resolveRetailer(auth, stringArg(input, "retailer"));
      const plannedFor = stringArg(input, "planned_for");
      if (plannedFor && !/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) return errorResult("planned_for must be YYYY-MM-DD");
      const result = await auth.supabase
        .from("shopping_trips")
        .insert({ household_id: household.id, retailer_id: retailer?.id ?? null, name: stringArg(input, "name") ?? (retailer ? `${retailer.name} shop` : "Shopping list"), status: "planning", planned_for: plannedFor ?? null, created_by: auth.userId })
        .select("id, household_id, retailer_id, name, status, planned_for, created_at")
        .single();
      if (result.error) throw result.error;
      return textResult({ household, created: asObject(result.data) });
    }

    if (name === "add_to_list") {
      const trip = await resolveTrip(auth, household.id, stringArg(input, "trip_id"));
      if (!trip) return errorResult("No active/planning list exists. Call create_shopping_list first.");
      const candidates = Array.isArray(input.items) ? input.items.slice(0, 100) : [];
      if (!candidates.length) return errorResult("items must contain at least one item");
      const changed: JsonObject[] = [];

      for (const raw of candidates) {
        const item = asObject(raw);
        const itemName = stringArg(item, "name");
        if (!itemName) continue;
        const need = await ensureNeed(auth, household.id, itemName);
        const quantity = Math.max(0.01, numberArg(item, "quantity") ?? need.manual_quantity ?? 1);
        const article = await preferredArticle(auth, household.id, need.id, trip.retailer_id);
        const existing = await auth.supabase
          .from("trip_items")
          .select("id, status")
          .eq("household_id", household.id)
          .eq("trip_id", trip.id)
          .eq("need_id", need.id)
          .maybeSingle();
        if (existing.error) throw existing.error;

        if (existing.data) {
          const updated = await auth.supabase
            .from("trip_items")
            .update({ suggested_quantity: quantity, actual_quantity: quantity, note: stringArg(item, "note") ?? null, article_id: article?.id ?? null, status: existing.data.status === "bought" ? "bought" : "pending" })
            .eq("id", existing.data.id)
            .eq("household_id", household.id)
            .select("id")
            .single();
          if (updated.error) throw updated.error;
          changed.push({ action: "updated", item_id: updated.data.id, need: need.name, quantity, article: article?.name ?? null });
          continue;
        }

        const category = await auth.supabase.from("store_categories").select("id").eq("household_id", household.id).eq("name", inferCategory(itemName)).is("retailer_id", null).maybeSingle();
        if (category.error) throw category.error;
        const created = await auth.supabase
          .from("trip_items")
          .insert({ household_id: household.id, trip_id: trip.id, need_id: need.id, article_id: article?.id ?? null, category_id: category.data?.id ?? null, suggested_quantity: quantity, actual_quantity: quantity, status: "pending", source: "manual", note: stringArg(item, "note") ?? null })
          .select("id")
          .single();
        if (created.error) throw created.error;
        changed.push({ action: "added", item_id: created.data.id, need: need.name, quantity, article: article?.name ?? null });
      }
      return textResult({ household, trip_id: trip.id, items: changed });
    }

    if (name === "update_list_item") {
      const itemId = stringArg(input, "item_id");
      if (!itemId) return errorResult("item_id is required");
      const existing = await auth.supabase.from("trip_items").select("id, suggested_quantity, actual_quantity, status").eq("id", itemId).eq("household_id", household.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) return errorResult("List item not found");
      const quantity = numberArg(input, "quantity");
      const status = stringArg(input, "status");

      if (status === "bought") {
        const boughtQuantity = quantity ?? Number(existing.data.actual_quantity ?? existing.data.suggested_quantity ?? 1);
        if (boughtQuantity <= 0) return errorResult("A bought quantity must be greater than zero");
        const result = await auth.supabase.rpc("mark_trip_item_bought", { p_trip_item_id: itemId, p_quantity: boughtQuantity });
        if (result.error) throw result.error;
      } else if (existing.data.status === "bought" && status === "pending") {
        const result = await auth.supabase.rpc("undo_trip_item_bought", { p_trip_item_id: itemId });
        if (result.error) throw result.error;
      } else {
        const patch: JsonObject = {};
        if (quantity !== undefined) {
          if (quantity < 0) return errorResult("quantity cannot be negative");
          patch.suggested_quantity = quantity || 1;
          patch.actual_quantity = quantity;
        }
        if (status) patch.status = status;
        if (Object.prototype.hasOwnProperty.call(input, "note")) patch.note = input.note;
        if (Object.keys(patch).length) {
          const result = await auth.supabase.from("trip_items").update(patch).eq("id", itemId).eq("household_id", household.id);
          if (result.error) throw result.error;
        }
      }
      const updated = await auth.supabase.from("trip_items").select("id, suggested_quantity, actual_quantity, status, note, completed_at").eq("id", itemId).single();
      if (updated.error) throw updated.error;
      return textResult({ household, item: asObject(updated.data) });
    }

    if (name === "remove_from_list") {
      const itemId = stringArg(input, "item_id");
      if (!itemId) return errorResult("item_id is required");
      const existing = await auth.supabase.from("trip_items").select("id, status").eq("id", itemId).eq("household_id", household.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) return textResult({ household, removed: false, message: "Item was already absent." });
      if (existing.data.status === "bought") return errorResult("Purchased items are retained as history. Undo the purchase first if it was a mistake.");
      const removed = await auth.supabase.from("trip_items").delete().eq("id", itemId).eq("household_id", household.id);
      if (removed.error) throw removed.error;
      return textResult({ household, removed: true, item_id: itemId });
    }

    if (name === "save_shopping_rule") {
      const instruction = stringArg(input, "instruction");
      if (!instruction) return errorResult("instruction is required");
      const result = await auth.supabase
        .from("shopping_rules")
        .insert({ household_id: household.id, instruction, active: true, created_by: auth.userId })
        .select("id, instruction, active, created_at")
        .single();
      if (result.error) throw result.error;
      return textResult({ household, rule: asObject(result.data) });
    }

    if (name === "remove_shopping_rule") {
      const ruleId = stringArg(input, "rule_id");
      if (!ruleId) return errorResult("rule_id is required");
      const result = await auth.supabase
        .from("shopping_rules")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", ruleId)
        .eq("household_id", household.id)
        .select("id, instruction, active, updated_at")
        .maybeSingle();
      if (result.error) throw result.error;
      return textResult({ household, rule: result.data ? asObject(result.data) : null, removed: Boolean(result.data) });
    }

    return errorResult(`Unknown Stapli tool '${name}'`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Stapli tool failed", error instanceof Error ? undefined : error);
  }
}
