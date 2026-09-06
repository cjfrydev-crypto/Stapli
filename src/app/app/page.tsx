import Link from "next/link";
import { getActiveTripView, getRetailers } from "@/lib/app-data";
import { ShoppingList } from "@/components/shopping-list";
import { addManualItemAction, completeTripAction, createTripAction } from "./actions";

function formatShopDate(value: string | null) {
  if (!value) return "Today";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const [view, retailers] = await Promise.all([getActiveTripView(), getRetailers()]);

  if (!view) {
    return (
      <div className="page-stack">
        <section className="page-heading">
          <p className="eyebrow">Shop</p>
          <h1>What’s the next run?</h1>
          <p>Start an empty list now, or let Upcoming build one from your buying rhythm.</p>
        </section>
        {params.error ? <div className="form-message form-message--error">{params.error}</div> : null}
        <section className="empty-shop-card">
          <div className="empty-illustration"><span>✓</span><span>+</span><span>✓</span></div>
          <h2>Start a shop</h2>
          <p>Choose where you’re going. Anything you add or tick becomes part of your household history.</p>
          <form action={createTripAction} className="form-stack compact-form">
            <label>Store<select name="retailer" defaultValue="tesco">{retailers.map((r) => <option value={r.slug} key={r.id}>{r.name}</option>)}</select></label>
            <label>Planned for<input type="date" name="plannedFor" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <button className="button button--primary button--wide">Start list</button>
          </form>
          <Link href="/app/upcoming" className="button button--ghost button--wide">Build from what’s due</Link>
        </section>
      </div>
    );
  }

  const { trip, items, categories } = view;
  return (
    <div className="page-stack shop-page">
      <section className="shop-heading">
        <div>
          <p className="eyebrow">{formatShopDate(trip.planned_for)}</p>
          <h1>{trip.retailer?.name ?? trip.name ?? "Shopping list"}</h1>
          <p>{items.length ? "Tap once when it’s in the trolley. Adjust quantity only when reality differs." : "Your list is empty — add the first thing below."}</p>
        </div>
        <span className="live-pill"><span />Shared live</span>
      </section>

      <form action={addManualItemAction} className="quick-add">
        <input type="hidden" name="tripId" value={trip.id} />
        <div className="quick-add__field"><span>+</span><input name="name" placeholder="Add milk, bananas, washing powder…" required autoComplete="off" /></div>
        <select name="categoryId" aria-label="Category" defaultValue=""> <option value="">Category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="qty-input" name="quantity" type="number" min="1" step="1" defaultValue="1" aria-label="Quantity" />
        <button className="button button--primary" type="submit">Add</button>
      </form>

      {items.length ? <ShoppingList tripId={trip.id} initialItems={items} /> : <div className="inline-empty"><strong>Nothing here yet.</strong><span>Add an item above — Stapli will remember it afterwards.</span></div>}

      <section className="shop-footer-actions">
        <form action={completeTripAction}>
          <input type="hidden" name="tripId" value={trip.id} />
          <button className="button button--secondary button--wide" type="submit">Finish this shop</button>
        </form>
        <p>Anything left unbought will stay available to carry into the next shop.</p>
      </section>
    </div>
  );
}
