import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/household";
import { calculateCadenceFromEvents } from "@/lib/cadence";

export async function getRetailers() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("retailers").select("id, slug, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getActiveTripView() {
  const household = await requireHousehold();
  const supabase = await createClient();
  const { data: trip, error } = await supabase
    .from("shopping_trips")
    .select("id, name, retailer_id, status, planned_for, created_at")
    .eq("household_id", household.id)
    .in("status", ["active", "planning"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!trip) return null;

  const { data: retailer } = trip.retailer_id
    ? await supabase.from("retailers").select("id, slug, name").eq("id", trip.retailer_id).single()
    : { data: null };

  const { data: tripItems, error: itemError } = await supabase
    .from("trip_items")
    .select("id, need_id, article_id, category_id, suggested_quantity, actual_quantity, status, source, note, sort_order, added_at")
    .eq("trip_id", trip.id)
    .order("sort_order")
    .order("added_at");
  if (itemError) throw itemError;

  const needIds = [...new Set((tripItems ?? []).map((item) => item.need_id))];
  const articleIds = [...new Set((tripItems ?? []).map((item) => item.article_id).filter(Boolean))] as string[];
  const categoryIds = [...new Set((tripItems ?? []).map((item) => item.category_id).filter(Boolean))] as string[];

  const [{ data: needs }, { data: articles }, { data: selectedCategories }, { data: fallbackCategories }] = await Promise.all([
    needIds.length ? supabase.from("needs").select("id, name").in("id", needIds) : Promise.resolve({ data: [] }),
    articleIds.length ? supabase.from("articles").select("id, name, pack_size").in("id", articleIds) : Promise.resolve({ data: [] }),
    categoryIds.length ? supabase.from("store_categories").select("id, name, sort_order").in("id", categoryIds) : Promise.resolve({ data: [] }),
    supabase.from("store_categories").select("id, name, sort_order").eq("household_id", household.id).is("retailer_id", null).order("sort_order"),
  ]);

  const defaultCategory = (fallbackCategories ?? []).find((category) => category.name === "Other") ?? fallbackCategories?.[0];
  const items = (tripItems ?? []).map((item) => {
    const need = (needs ?? []).find((n) => n.id === item.need_id);
    const article = (articles ?? []).find((a) => a.id === item.article_id);
    const category = (selectedCategories ?? []).find((c) => c.id === item.category_id) ?? defaultCategory;
    return {
      ...item,
      needName: need?.name ?? "Item",
      articleName: article?.name ?? null,
      categoryName: category?.name ?? "Other",
      categoryOrder: category?.sort_order ?? 999,
    };
  });

  return {
    household,
    trip: { ...trip, retailer },
    items,
    categories: fallbackCategories ?? [],
  };
}

export async function getProductViews() {
  const household = await requireHousehold();
  const supabase = await createClient();
  const since = new Date(Date.now() - 370 * 86_400_000).toISOString();
  const [{ data: needs, error: needsError }, { data: events, error: eventsError }, { data: articles, error: articlesError }] = await Promise.all([
    supabase.from("needs").select("id, name, prediction_mode, manual_cadence_days, manual_quantity, unit, active, updated_at").eq("household_id", household.id).eq("active", true).order("name"),
    supabase.from("purchase_events").select("id, need_id, quantity, purchased_at, context, retailer_id, article_id").eq("household_id", household.id).gte("purchased_at", since).order("purchased_at"),
    supabase.from("articles").select("id, need_id, retailer_id, name, brand, pack_size, is_preferred").eq("household_id", household.id),
  ]);
  if (needsError) throw needsError;
  if (eventsError) throw eventsError;
  if (articlesError) throw articlesError;

  return (needs ?? []).map((need) => {
    const needArticles = (articles ?? []).filter((article) => article.need_id === need.id);
    const preferredArticle = needArticles.find((article) => article.is_preferred);
    return {
      ...need,
      stats: calculateCadenceFromEvents(
        need,
        (events ?? []).filter((event) => event.need_id === need.id),
        { quantityArticleId: preferredArticle?.id },
      ),
      articles: needArticles,
    };
  });
}

export async function getImportSummary() {
  const household = await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("retailer_imports")
    .select("id, source_filename, status, transaction_count, line_count, imported_at, retailer_id")
    .eq("household_id", household.id)
    .order("imported_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data ?? [];
}
