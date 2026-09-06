import { getProductViews } from "@/lib/app-data";
import { formatDays, formatQuantity, dueLabel } from "@/lib/cadence";
import { updateProductSettingsAction } from "./actions";

export default async function ProductsPage() {
  const products = await getProductViews();
  return (
    <div className="page-stack">
      <section className="page-heading"><p className="eyebrow">Products</p><h1>Your household’s usuals.</h1><p>The article can change by retailer. The underlying need and purchase rhythm belong to your household.</p></section>
      <div className="product-grid">
        {products.map((product) => (
          <article className="product-card" key={product.id}>
            <div className="product-card__top">
              <div><h2>{product.name}</h2><p>{product.articles.find((a) => a.is_preferred)?.name ?? product.articles[0]?.name ?? "No preferred article yet"}</p></div>
              <span className={`mode-pill mode-pill--${product.prediction_mode}`}>{product.prediction_mode}</span>
            </div>
            <div className="product-metrics">
              <div><span>16-week actual</span><strong>{formatDays(product.stats.observedCadence16w)}</strong></div>
              <div><span>Set cadence</span><strong>{product.prediction_mode === "manual" ? formatDays(product.manual_cadence_days ?? undefined) : "Auto"}</strong></div>
              <div><span>Recent qty</span><strong>×{formatQuantity(product.stats.effectiveQuantity)}</strong></div>
              <div><span>Next</span><strong>{dueLabel(product.stats.nextExpectedAt)}</strong></div>
            </div>
            <details className="product-settings">
              <summary>Adjust prediction</summary>
              <form action={updateProductSettingsAction} className="product-settings__form">
                <input type="hidden" name="id" value={product.id} />
                <label>Prediction<select name="mode" defaultValue={product.prediction_mode}><option value="auto">Auto — learn from purchases</option><option value="manual">Manual — use my cadence</option><option value="off">Off — observe only</option></select></label>
                <div className="form-row"><label>Cadence (days)<input name="cadence" type="number" min="1" step="0.5" defaultValue={product.manual_cadence_days ?? ""} /></label><label>Usual quantity<input name="quantity" type="number" min="1" step="1" defaultValue={product.manual_quantity ?? ""} /></label></div>
                <button className="button button--secondary" type="submit">Save</button>
              </form>
            </details>
          </article>
        ))}
        {!products.length ? <div className="empty-shop-card"><h2>No products yet</h2><p>Your product library appears as soon as you import history or add things to a shopping list.</p></div> : null}
      </div>
    </div>
  );
}
