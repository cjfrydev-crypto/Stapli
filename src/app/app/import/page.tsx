import { TescoImporter } from "@/components/tesco-importer";
import { getImportSummary } from "@/lib/app-data";

export default async function ImportPage() {
  const imports = await getImportSummary();
  return (
    <div className="page-stack">
      <section className="page-heading"><p className="eyebrow">Import</p><h1>Start with the history you already have.</h1><p>Stapli keeps the original retailer records intact, then builds a separate household model from repeat purchases. That means better matching can be added later without losing source data.</p></section>
      <section className="import-card">
        <div className="retailer-lockup"><span className="retailer-badge retailer-badge--tesco">T</span><div><h2>Tesco</h2><p>Clubcard transaction export</p></div></div>
        <TescoImporter />
        <div className="privacy-note"><strong>Your household stays isolated.</strong><span>Imports are stored behind Supabase row-level security and are only readable by members of this household.</span></div>
      </section>
      {imports.length ? (
        <section>
          <div className="section-heading"><div><h2>Recent imports</h2><p>Re-uploading the same export won’t duplicate purchases.</p></div></div>
          <div className="history-list">{imports.map((item) => <div key={item.id}><div><strong>{item.source_filename ?? "Retailer export"}</strong><span>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.imported_at))}</span></div><div><strong>{item.line_count.toLocaleString()}</strong><span>lines</span></div><span className={`status-dot status-dot--${item.status}`}>{item.status}</span></div>)}</div>
        </section>
      ) : null}
    </div>
  );
}
