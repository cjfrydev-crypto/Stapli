"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string;
  needName: string;
  articleName: string | null;
  categoryName: string;
  categoryOrder: number;
  suggested_quantity: number;
  actual_quantity: number | null;
  status: "pending" | "bought" | "unavailable" | "not_needed" | "deferred";
  source: "manual" | "predicted" | "recipe" | "carry_over" | "imported";
};

type ShoppingItem = Omit<Item, "actual_quantity"> & { actual_quantity: number };

function cleanQty(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeItem(item: Item): ShoppingItem {
  return { ...item, actual_quantity: item.actual_quantity ?? item.suggested_quantity };
}

export function ShoppingList({ tripId, initialItems }: { tripId: string; initialItems: Item[] }) {
  const [items, setItems] = useState<ShoppingItem[]>(() => initialItems.map(normalizeItem));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channel = supabase
      .channel(`trip:${tripId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_items", filter: `trip_id=eq.${tripId}` }, (payload) => {
        const next = payload.new as Partial<Item> & { id: string };
        setItems((current) => current.map((item) => {
          if (item.id !== next.id) return item;
          return {
            ...item,
            ...next,
            actual_quantity: next.actual_quantity ?? item.actual_quantity ?? item.suggested_quantity,
          };
        }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, tripId]);

  const grouped = useMemo(() => {
    const map = new Map<string, { order: number; items: ShoppingItem[] }>();
    for (const item of items) {
      const group = map.get(item.categoryName) ?? { order: item.categoryOrder, items: [] };
      group.items.push(item);
      map.set(item.categoryName, group);
    }
    return [...map.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [items]);

  const bought = items.filter((item) => item.status === "bought").length;

  function patchLocal(id: string, patch: Partial<ShoppingItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function toggleBought(item: ShoppingItem) {
    if (item.status === "bought") {
      patchLocal(item.id, { status: "pending" });
      const { error } = await supabase.rpc("undo_trip_item_bought", { p_item_id: item.id });
      if (error) patchLocal(item.id, { status: "bought" });
      return;
    }
    const quantity = item.actual_quantity;
    patchLocal(item.id, { status: "bought", actual_quantity: quantity });
    const { error } = await supabase.rpc("mark_trip_item_bought", { p_item_id: item.id, p_actual_quantity: quantity });
    if (error) patchLocal(item.id, { status: "pending" });
  }

  function changeQuantity(item: ShoppingItem, delta: number) {
    const next = cleanQty(Math.max(1, item.actual_quantity + delta));
    patchLocal(item.id, { actual_quantity: next });
    if (item.status === "bought") {
      startTransition(async () => {
        await supabase.rpc("mark_trip_item_bought", { p_item_id: item.id, p_actual_quantity: next });
      });
    }
  }

  async function setOutcome(item: ShoppingItem, status: "unavailable" | "not_needed" | "deferred") {
    const previous = item.status;
    patchLocal(item.id, { status });
    setExpanded(null);
    const { error } = await supabase.from("trip_items").update({ status, completed_at: new Date().toISOString() }).eq("id", item.id);
    if (error) patchLocal(item.id, { status: previous });
  }

  return (
    <div className="shopping-list">
      <div className="shop-progress"><div><strong>{bought}</strong> of {items.length} picked</div><div className="progress-track"><span style={{ width: `${items.length ? (bought / items.length) * 100 : 0}%` }} /></div></div>
      {grouped.map(([category, group]) => (
        <section className="list-group" key={category}>
          <div className="list-group__heading"><h2>{category}</h2><span>{group.items.filter((i) => i.status !== "bought").length}</span></div>
          <div className="item-stack">
            {group.items.map((item) => {
              const done = item.status === "bought";
              const unresolved = item.status === "unavailable" || item.status === "deferred";
              return (
                <article className={`shop-item ${done ? "shop-item--done" : ""} ${unresolved ? "shop-item--muted" : ""}`} key={item.id}>
                  <button className="check-button" onClick={() => void toggleBought(item)} aria-label={done ? `Undo ${item.needName}` : `Mark ${item.needName} bought`}><span>{done ? "✓" : ""}</span></button>
                  <div className="shop-item__copy">
                    <div className="shop-item__title-row"><strong>{item.needName}</strong>{item.source !== "manual" ? <span className={`source-pill source-pill--${item.source}`}>{item.source === "carry_over" ? "carried over" : item.source}</span> : null}</div>
                    {item.articleName ? <p>{item.articleName}</p> : <p className="muted-copy">No store-specific article chosen</p>}
                    {unresolved ? <p className="outcome-copy">{item.status === "unavailable" ? "Couldn’t get last time" : "Carry to another shop"}</p> : null}
                  </div>
                  <div className="quantity-control" aria-label={`Quantity for ${item.needName}`}>
                    <button disabled={isPending} onClick={() => changeQuantity(item, -1)}>−</button>
                    <span>{item.actual_quantity}</span>
                    <button disabled={isPending} onClick={() => changeQuantity(item, 1)}>+</button>
                  </div>
                  <button className="more-button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-label={`More options for ${item.needName}`}>•••</button>
                  {expanded === item.id ? (
                    <div className="item-menu">
                      <button onClick={() => void setOutcome(item, "unavailable")}>Couldn’t get it</button>
                      <button onClick={() => void setOutcome(item, "not_needed")}>Still have some</button>
                      <button onClick={() => void setOutcome(item, "deferred")}>Leave for next shop</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
