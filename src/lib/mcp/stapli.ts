import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inferCategory, normalizeKey } from "@/lib/retailer-normalize";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

type JsonObject = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: JsonObject; isError?: boolean };

type AuthContext = {
  token: string;
  userId: string;
  email?: string;
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

function textResult(data: JsonObject): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(message: string, details?: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, details: details ?? null }, null, 2) }],
    structuredContent: { error: message, details: details ?? null },
    isError: true,
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringArg(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function decodeJwtPayload(token: string): JsonObject | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as JsonObject;
  } catch {
    return null;
  }
}

export async function authenticateMcpToken(token: string): Promise<AuthContext | null> {
  const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;

  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : 0;
  const issuer = typeof payload?.iss === "string" ? payload.iss : "";
  const audience = payload?.aud;
  const validAudience = audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated"));
  if (!exp || exp <= Math.floor(Date.now() / 1000) || issuer !== `${SUPABASE_URL}/auth/v1` || !validAudience) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    token,
    userId: data.user.id,
    email: data.user.email,
    expiresAt: exp,
    clientId: typeof payload?.client_id === "string" ? payload.client_id : undefined,
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

  const ids = memberships.map((membership) => String(membership.household_id));
  const { data: households, error: householdError } = await auth.supabase
    .from("households")
    .select("id, name")
    .in("id", ids);
  if (householdError) throw householdError;

  return (households ?? []).map((household) => ({
    id: String(household.id),
    name: String(household.name),
    role: String(memberships.find((membership) => membership.household_id === household.id)?.role ?? "member"),
  }));
}

async function resolveHousehold(auth: AuthContext, requested?: string): Promise<Household> {
  const households = await householdsFor(auth);
  if (!households.length) throw new Error("This Stapli account does not have a household yet.");
  if (requested) {
    const match = households.find((household) => household.id === requested);
    if (!match) throw new Error("That household is not available to this user.");
    return match;
  }
  if (households.length > 1) throw new Error("This user belongs to multiple households. Pass household_id explicitly.");
  return households[0];
}

async function resolveRetailer(auth: AuthContext, retailer?: string) {
  if (!retailer) return null;
  const slug = normalizeKey(retailer);
  const { data: bySlug } = await auth.supabase.from("retailers").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (bySlug) return bySlug;
  const { data: byName } = await auth.supabase.from("retailers").select("id, slug, name").ilike("name", retailer).maybeSingle();
  if (byName) return byName;
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
  return rows.find((trip) => trip.status === "active") ?? rows[0] ?? null;
}

async function tripById(auth: AuthContext, householdId: string, tripId?: string): Promise<Trip | null> {
  if (!tripId) return currentTrip(auth, householdId);
  const { data, error } = await auth.supabase
    .from("shopping_trips")
    .select("id, household_id, retailer_id, name, status, planned_for, created_at")
    .eq("id", tripId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  return (data as Trip | null) ?? null;
}

async function lookupMap(auth: AuthContext, table: "needs" | "articles" | "retailers", ids: string[]) {
  if (!ids.length) return new Map<string, JsonObject>();
  const fields = table === "retailers" ? "id, name, slug" : table === "articles" ? "id, name, brand, pack_size, retailer_id, need_id, is_preferred" : "id, name, unit, prediction_mode, manual_quantity, manual_cadence_days, notes";
  const { data, error } = await auth.supabase.from(table).select(fields).in("id", [...new Set(ids)]);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [String(row.id), row as JsonObject]));
}

async function getList(auth: AuthContext, householdId: string, trip: Trip) {
  const { data: rows, error } = await auth.supabase
    .from("trip_items")
    .select("id, need_id, article_id, category_id, suggested_quantity, actual_quantity, status, source, note, sort_order, added_at")
    .eq("household_id", householdId)
    .eq("trip_id", trip.id)
    .order("sort_order", { ascending: true })
    .order("added_at", { ascending: true });
  if (error) throw error;

  const items = rows ?? [];
  const needs = await lookupMap(auth, "needs", items.map((row) => String(row.need_id)));
  const articles = await lookupMap(auth, "articles", items.flatMap((row) => row.article_id ? [String(row.article_id)] : []));
  const retailers = await lookupMap(auth, "retailers", trip.retailer_id ? [trip.retailer_id] : []);

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      status: trip.status,
      planned_for: trip.planned_for,
      retailer: trip.retailer_id ? retailers.get(trip.retailer_id)?.name ?? null : null,
    },
    items: items.map((row) => ({
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
  const { data: existing, error } = await auth.supabase
    .from("needs")
    .select("id, household_id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes")
    .eq("household_id", householdId)
    .eq("normalized_key", key)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing as Need;

  const { data: created, error: createError } = await auth.supabase
    .from("needs")
    .insert({ household_id: householdId, name: name.trim(), normalized_key: key, prediction_mode: "auto", unit: "item" })
    .select("id, household_id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes")
    .single();
  if (createError) {
    const { data: raced, error: racedError } = await auth.supabase
      .from("needs")
      .select("id, household_id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes")
      .eq("household_id", householdId)
      .eq("normalized_key", key)
      .single();
    if (racedError) throw createError;
    return raced as Need;
  }
  return created as Need;
}

async function preferredArticle(auth: AuthContext, householdId: string, needId: string, retailerId: string | null) {
  let query = auth.supabase
    .from("articles")
    .select("id, name, brand, pack_size, retailer_id, is_preferred")
    .eq("household_id", householdId)
    .eq("need_id", needId);
  if (retailerId) query = query.eq("retailer_id", retailerId);
  const { data, error } = await query.order("is_preferred", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export const TOOL_DEFINITIONS = [
  {
    name: "list_households",
    title: "List Stapli households",
    description: "List the households this signed-in Stapli user can access. Use this first when household context is ambiguous.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_current_list",
    title: "Get current shopping list",
    description: "Read the current active or planning shopping list, including quantities and exact products when known.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, trip_id: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "search_items",
    title: "Search known shopping items",
    description: "Search household needs and known retailer articles. Use this before inventing a new item when the user refers to something they buy regularly.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, query: { type: "string", minLength: 1 }, limit: { type: "number", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_purchase_history",
    title: "Get purchase history",
    description: "Read recent actual household purchases for pattern analysis. Stapli returns facts; the AI should do flexible reasoning over them.",
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
    description: "Create a new Stapli shopping trip/list for a retailer or date. Do not create duplicates when an appropriate current list already exists.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, retailer: { type: "string" }, name: { type: "string" }, planned_for: { type: "string", description: "YYYY-MM-DD" } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "add_to_list",
    title: "Add items to shopping list",
    description: "Add one or more household needs to a Stapli list. Existing items on that list are updated instead of duplicated.",
    inputSchema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        trip_id: { type: "string" },
        items: {
          type: "array", minItems: 1, maxItems: 100,
          items: { type: "object", properties: { name: { type: "string", minLength: 1 }, quantity: { type: "number", exclusiveMinimum: 0 }, note: { type: "string" } }, required: ["name"], additionalProperties: false },
        },
      },
      required: ["items"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_list_item",
    title: "Update shopping list item",
    description: "Change a list item's quantity, note or outcome. Setting status to bought records an actual purchase through Stapli's transactional purchase RPC.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, item_id: { type: "string" }, quantity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] }, status: { type: "string", enum: ["pending", "bought", "unavailable", "not_needed", "deferred"] } }, required: ["item_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "remove_from_list",
    title: "Remove shopping list item",
    description: "Remove a pending/non-purchased item from a list. Purchased items are not deleted; undo the purchase first if that is genuinely intended.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, item_id: { type: "string" } }, required: ["item_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "save_shopping_rule",
    title: "Save shopping rule",
    description: "Save a natural-language standing household shopping instruction, such as a preferred quantity, retailer preference or prediction exception.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, instruction: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["instruction"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "remove_shopping_rule",
    title: "Remove shopping rule",
    description: "Deactivate a standing shopping rule. This keeps an audit trail rather than deleting the historical instruction.",
    inputSchema: { type: "object", properties: { household_id: { type: "string" }, rule_id: { type: "string" } }, required: ["rule_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
] as const;

export async function callStapliTool(auth: AuthContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const input = asObject(rawInput);
  try {
    if (name === "list_households") {
      return textResult({ households: await householdsFor(auth) });
    }

    const household = await resolveHousehold(auth, stringArg(input, "household_id"));

    if (name === "get_current_list") {
      const trip = await tripById(auth, household.id, stringArg(input, "trip_id"));
      if (!trip) return textResult({ household, trip: null, items: [], message: "There is no active or planning shopping list yet." });
      return textResult({ household, ...(await getList(auth, household.id, trip)) });
    }

    if (name === "search_items") {
      const query = stringArg(input, "query");
      if (!query) return errorResult("query is required");
      const limit = Math.min(50, Math.max(1, numberArg(input, "limit") ?? 20));
      const { data: needRows, error: needError } = await auth.supabase
        .from("needs")
        .select("id, name, normalized_key, prediction_mode, manual_cadence_days, manual_quantity, unit, notes")
        .eq("household_id", household.id)
        .ilike("name", `%${query}%`)
        .limit(limit);
      if (needError) throw needError;
      const { data: articleRows, error: articleError } = await auth.supabase
        .from("articles")
        .select("id, need_id, retailer_id, name, brand, pack_size, is_preferred, last_price, currency")
        .eq("household_id", household.id)
        .ilike("name", `%${query}%`)
        .limit(limit);
      if (articleError) throw articleError;
      const articleNeedIds = (articleRows ?? []).map((row) => String(row.need_id));
      let linkedNeeds: JsonObject[] = [];
      if (articleNeedIds.length) {
        const { data, error } = await auth.supabase.from("needs").select("id, name, normalized_key, unit").in("id", [...new Set(articleNeedIds)]);
        if (error) throw error;
        linkedNeeds = (data ?? []) as JsonObject[];
      }
      const retailerIds = (articleRows ?? []).map((row) => String(row.retailer_id));
      const retailers = await lookupMap(auth, "retailers", retailerIds);
      return textResult({
        household,
        needs: needRows ?? [],
        articles: (articleRows ?? []).map((row) => ({ ...row, retailer: retailers.get(String(row.retailer_id))?.name ?? null })),
        linked_needs: linkedNeeds,
      });
    }

    if (name === "get_purchase_history") {
      const days = Math.min(3650, Math.max(1, numberArg(input, "days") ?? 120));
      const limit = Math.min(300, Math.max(1, numberArg(input, "limit") ?? 150));
      const queryText = stringArg(input, "query")?.toLowerCase();
      const retailer = await resolveRetailer(auth, stringArg(input, "retailer"));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      let request = auth.supabase
        .from("purchase_events")
        .select("id, need_id, article_id, retailer_id, quantity, unit_price, total_price, purchased_at, context")
        .eq("household_id", household.id)
        .gte("purchased_at", since)
        .order("purchased_at", { ascending: false })
        .limit(limit);
      if (retailer) request = request.eq("retailer_id", retailer.id);
      const { data: purchases, error } = await request;
      if (error) throw error;
      const needs = await lookupMap(auth, "needs", (purchases ?? []).map((row) => String(row.need_id)));
      const articles = await lookupMap(auth, "articles", (purchases ?? []).flatMap((row) => row.article_id ? [String(row.article_id)] : []));
      const retailers = await lookupMap(auth, "retailers", (purchases ?? []).flatMap((row) => row.retailer_id ? [String(row.retailer_id)] : []));
      const mapped = (purchases ?? []).map((row) => ({
        purchased_at: row.purchased_at,
        need: needs.get(String(row.need_id))?.name ?? null,
        article: row.article_id ? articles.get(String(row.article_id))?.name ?? null : null,
        retailer: row.retailer_id ? retailers.get(String(row.retailer_id))?.name ?? null : null,
        quantity: Number(row.quantity),
        unit_price: row.unit_price == null ? null : Number(row.unit_price),
        total_price: row.total_price == null ? null : Number(row.total_price),
        context: row.context,
      })).filter((row) => !queryText || String(row.need ?? "").toLowerCase().includes(queryText) || String(row.article ?? "").toLowerCase().includes(queryText));
      return textResult({ household, period_days: days, purchases: mapped });
    }

    if (name === "get_shopping_rules") {
      let request = auth.supabase
        .from("shopping_rules")
        .select("id, instruction, active, created_at, updated_at")
        .eq("household_id", household.id)
        .order("created_at", { ascending: true });
      if (input.include_inactive !== true) request = request.eq("active", true);
      const { data, error } = await request;
      if (error) throw error;
      return textResult({ household, rules: data ?? [] });
    }

    if (name === "create_shopping_list") {
      const retailer = await resolveRetailer(auth, stringArg(input, "retailer"));
      const plannedFor = stringArg(input, "planned_for");
      if (plannedFor && !/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) return errorResult("planned_for must be YYYY-MM-DD");
      const { data, error } = await auth.supabase
        .from("shopping_trips")
        .insert({
          household_id: household.id,
          retailer_id: retailer?.id ?? null,
          name: stringArg(input, "name") ?? (retailer ? `${retailer.name} shop` : "Shopping list"),
          status: "planning",
          planned_for: plannedFor ?? null,
          created_by: auth.userId,
        })
        .select("id, household_id, retailer_id, name, status, planned_for, created_at")
        .single();
      if (error) throw error;
      return textResult({ household, created: data as JsonObject });
    }

    if (name === "add_to_list") {
      const trip = await tripById(auth, household.id, stringArg(input, "trip_id"));
      if (!trip) return errorResult("No active/planning list exists. Call create_shopping_list first.");
      const items = Array.isArray(input.items) ? input.items : [];
      if (!items.length) return errorResult("items must contain at least one item");
      const added: JsonObject[] = [];
      for (const candidate of items.slice(0, 100)) {
        const item = asObject(candidate);
        const itemName = stringArg(item, "name");
        if (!itemName) continue;
        const need = await ensureNeed(auth, household.id, itemName);
        const quantity = Math.max(0.01, numberArg(item, "quantity") ?? need.manual_quantity ?? 1);
        const article = await preferredArticle(auth, household.id, need.id, trip.retailer_id);
        const { data: existing, error: existingError } = await auth.supabase
          .from("trip_items")
          .select("id, suggested_quantity, actual_quantity, status")
          .eq("household_id", household.id)
          .eq("trip_id", trip.id)
          .eq("need_id", need.id)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) {
          const { data: updated, error: updateError } = await auth.supabase
            .from("trip_items")
            .update({ suggested_quantity: quantity, actual_quantity: quantity, note: stringArg(item, "note") ?? null, article_id: article?.id ?? null, status: existing.status === "bought" ? "bought" : "pending" })
            .eq("id", existing.id)
            .eq("household_id", household.id)
            .select("id, suggested_quantity, actual_quantity, status")
            .single();
          if (updateError) throw updateError;
          added.push({ action: "updated", item_id: updated.id, need: need.name, quantity, article: article?.name ?? null });
        } else {
          const categoryName = inferCategory(itemName);
          const { data: category } = await auth.supabase.from("store_categories").select("id").eq("household_id", household.id).eq("name", categoryName).is("retailer_id", null).maybeSingle();
          const { data: created, error: createError } = await auth.supabase
            .from("trip_items")
            .insert({ household_id: household.id, trip_id: trip.id, need_id: need.id, article_id: article?.id ?? null, category_id: category?.id ?? null, suggested_quantity: quantity, actual_quantity: quantity, status: "pending", source: "manual", note: stringArg(item, "note") ?? null })
            .select("id, suggested_quantity, actual_quantity, status")
            .single();
          if (createError) throw createError;
          added.push({ action: "added", item_id: created.id, need: need.name, quantity, article: article?.name ?? null });
        }
      }
      return textResult({ household, trip_id: trip.id, items: added });
    }

    if (name === "update_list_item") {
      const itemId = stringArg(input, "item_id");
      if (!itemId) return errorResult("item_id is required");
      const { data: existing, error: existingError } = await auth.supabase
        .from("trip_items")
        .select("id, household_id, suggested_quantity, actual_quantity, status")
        .eq("id", itemId)
        .eq("household_id", household.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return errorResult("List item not found");
      const quantity = numberArg(input, "quantity");
      const status = stringArg(input, "status");
      if (status === "bought") {
        const boughtQuantity = quantity ?? Number(existing.actual_quantity ?? existing.suggested_quantity ?? 1);
        if (boughtQuantity <= 0) return errorResult("A bought quantity must be greater than zero");
        const { error } = await auth.supabase.rpc("mark_trip_item_bought", { p_trip_item_id: itemId, p_quantity: boughtQuantity });
        if (error) throw error;
      } else if (existing.status === "bought" && status === "pending") {
        const { error } = await auth.supabase.rpc("undo_trip_item_bought", { p_trip_item_id: itemId });
        if (error) throw error;
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
          const { error } = await auth.supabase.from("trip_items").update(patch).eq("id", itemId).eq("household_id", household.id);
          if (error) throw error;
        }
      }
      const { data: updated, error: updatedError } = await auth.supabase.from("trip_items").select("id, suggested_quantity, actual_quantity, status, note, completed_at").eq("id", itemId).single();
      if (updatedError) throw updatedError;
      return textResult({ household, item: updated as JsonObject });
    }

    if (name === "remove_from_list") {
      const itemId = stringArg(input, "item_id");
      if (!itemId) return errorResult("item_id is required");
      const { data: item, error } = await auth.supabase.from("trip_items").select("id, status").eq("id", itemId).eq("household_id", household.id).maybeSingle();
      if (error) throw error;
      if (!item) return textResult({ household, removed: false, message: "Item was already absent." });
      if (item.status === "bought") return errorResult("Purchased items are retained as history. Undo the purchase before removing it if that was a mistake.");
      const { error: deleteError } = await auth.supabase.from("trip_items").delete().eq("id", itemId).eq("household_id", household.id);
      if (deleteError) throw deleteError;
      return textResult({ household, removed: true, item_id: itemId });
    }

    if (name === "save_shopping_rule") {
      const instruction = stringArg(input, "instruction");
      if (!instruction) return errorResult("instruction is required");
      const { data, error } = await auth.supabase
        .from("shopping_rules")
        .insert({ household_id: household.id, instruction, active: true, created_by: auth.userId })
        .select("id, instruction, active, created_at")
        .single();
      if (error) throw error;
      return textResult({ household, rule: data as JsonObject });
    }

    if (name === "remove_shopping_rule") {
      const ruleId = stringArg(input, "rule_id");
      if (!ruleId) return errorResult("rule_id is required");
      const { data, error } = await auth.supabase
        .from("shopping_rules")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", ruleId)
        .eq("household_id", household.id)
        .select("id, instruction, active, updated_at")
        .maybeSingle();
      if (error) throw error;
      return textResult({ household, rule: data ?? null, removed: Boolean(data) });
    }

    return errorResult(`Unknown Stapli tool '${name}'`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Stapli tool failed", error instanceof Error ? undefined : error);
  }
}
