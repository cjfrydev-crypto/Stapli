import { getProductViews, getRetailers } from "@/lib/app-data";
import { dueLabel, formatDays, formatQuantity } from "@/lib/cadence";
import { generateTripAction } from "../actions";

export default async function UpcomingPage() {
  const [products, retailers] = await Promise.all([getProductViews(), getRetailers()]);
  const now = new Date();
  const upcoming = products
    .filter((product) => product.stats.nextExpectedAt)
    .sort((a, b) => new Date(a.stats.nextExpectedAt!).getTime() - new Date(b.stats.nextExpectedAt!).getTime());
  const learning = products.filter((product) => !product.stats.nextExpectedAt);

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div><p className="eyebrow">Upcoming</p><h1>Your next shop, before you write it.</h1><p>Stapli compares what you told it with what your household actually does.</p></div>
        <div className="stat-card"><strong>{upcoming.filter((p) => new Date(p.stats.nextExpectedAt!) <= now).length}</strong><span>due now</span></div>
      </section>

      <section className="build-shop-card">
        <div><span className="section-kicker">Build a trip</span><h2>Generate the next list</h2><p>Pick a store and Stapli will add everything expected by that date, using your preferred article there when it knows one.</p></div>
        <form action={generateTripAction} className="build-shop-form">
          <select name="retailer" defaultValue="tesco">{retailers.map((r) => <option value={r.slug} key={r.id}>{r.name}</option>)}</select>
          <input type="date" name="plannedFor" defaultValue={new Date().toISOString().slice(0, 10)} />
          <button className="button button--primary">Build list</button>
        </form>
      </section>

      <section>
        <div className="section-heading"><div><h2>Buying rhythm</h2><p>Observed cadence is always shown, even when prediction is manual or off.</p></div><span>{products.length} products</span></div>
        <div className="cadence-table-wrap">
          <table className="cadence-table">
            <thead><tr><th>Product</th><th>Mode</th><th>Set</th><th>16-week actual</th><th>Usual qty</th><th>Next</th></tr></thead>
            <tbody>
              {upcoming.slice(0, 60).map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong>{product.stats.trend !== "insufficient" && product.stats.trend !== "stable" ? <small className={`trend trend--${product.stats.trend}`}>Buying {product.stats.trend}</small> : null}</td>
                  <td><span className={`mode-pill mode-pill--${product.prediction_mode}`}>{product.prediction_mode}</span></td>
                  <td>{product.prediction_mode === "manual" ? formatDays(product.manual_cadence_days ?? undefined) : "—"}</td>
                  <td><strong>{formatDays(product.stats.observedCadence16w)}</strong></td>
                  <td>{formatQuantity(product.stats.effectiveQuantity)}</td>
                  <td><span className={new Date(product.stats.nextExpectedAt!) <= now ? "due due--now" : "due"}>{dueLabel(product.stats.nextExpectedAt)}</span></td>
                </tr>
              ))}
              {!upcoming.length && <tr><td colSpan={6} className="empty-cell">Import some purchase history or shop with Stapli a few times and predictions will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
        {learning.length ? <p className="table-note">{learning.length} more product{learning.length === 1 ? " is" : "s are"} still learning — they remain visible in Products.</p> : null}
      </section>
    </div>
  );
}
