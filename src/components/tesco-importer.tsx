"use client";

import { useRef, useState } from "react";

type ImportResult = {
  ok?: boolean;
  alreadyImported?: boolean;
  transactions?: number;
  lines?: number;
  recurringNeeds?: number;
  purchaseEvents?: number;
  error?: string;
};

export function TescoImporter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload() {
    if (!file) return;
    setStatus("uploading");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/import/tesco", { method: "POST", body });
    const payload = await response.json() as ImportResult;
    setResult(payload);
    setStatus(response.ok ? "done" : "error");
  }

  return (
    <div className="import-panel">
      <div className="drop-zone" onClick={() => inputRef.current?.click()}>
        <div className="drop-zone__icon">⇩</div>
        <div><strong>{file ? file.name : "Choose your Tesco export"}</strong><span>{file ? `${(file.size / 1024).toFixed(0)} KB` : "ZIP or JSON from Tesco’s data export"}</span></div>
        <input ref={inputRef} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus("idle"); setResult(null); }} />
      </div>
      <button className="button button--primary button--wide" disabled={!file || status === "uploading"} onClick={() => void upload()}>
        {status === "uploading" ? "Importing purchase history…" : "Import purchase history"}
      </button>
      {status === "done" && result ? (
        <div className="import-result import-result--success">
          <strong>{result.alreadyImported ? "Already safely imported" : "History imported"}</strong>
          {result.alreadyImported ? <p>Stapli recognised this exact Tesco export and left your existing history untouched.</p> : <p>{result.transactions?.toLocaleString()} transactions · {result.lines?.toLocaleString()} item lines · {result.recurringNeeds?.toLocaleString()} recurring needs identified.</p>}
        </div>
      ) : null}
      {status === "error" && result?.error ? <div className="import-result import-result--error"><strong>Couldn’t import that file</strong><p>{result.error}</p></div> : null}
    </div>
  );
}
