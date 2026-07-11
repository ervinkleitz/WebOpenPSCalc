import { useState, useEffect } from "react";
import { api } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  server: string;
  // Load the decoded build into the editor. Called before any "unmapped" list is shown.
  onImported: (build: any, unmapped: string[]) => void;
}

export default function ImportJaludevModal({ open, onClose, server, onImported }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unmapped, setUnmapped] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const reset = () => { setUrl(""); setErr(""); setUnmapped(null); };
  const close = () => { reset(); onClose(); };

  async function doImport() {
    setBusy(true);
    setErr("");
    try {
      const res = await api.importJaludev(url.trim(), server);
      onImported(res.build, res.unmapped || []);
      if (res.unmapped && res.unmapped.length) setUnmapped(res.unmapped); // keep open to show skips
      else close();
    } catch (e: any) {
      setErr(e?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import from the jaludev calculator</h2>
          <button onClick={close} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {unmapped ? (
            <>
              <p className="hint-text" style={{ marginTop: 0 }}>
                Build imported. <strong>{unmapped.length}</strong> item{unmapped.length === 1 ? "" : "s"} couldn't
                be matched (named differently or missing on the jaludev calculator) and {unmapped.length === 1 ? "was" : "were"} skipped —
                set {unmapped.length === 1 ? "it" : "them"} manually:
              </p>
              <ul className="import-unmapped">
                {unmapped.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
              <div className="field-row" style={{ marginTop: "0.6rem" }}>
                <button className="primary" onClick={close}>Done</button>
              </div>
            </>
          ) : (
            <>
              <p className="hint-text" style={{ marginTop: 0 }}>
                Paste a build link from <strong>payonrocalc.jaludev.com</strong>. Job, level, stats, refines and
                gear/cards are imported; anything the jaludev calculator names differently or doesn't have can't be
                matched and will be listed so you can set it manually.
              </p>
              <p className="hint-text" style={{ marginTop: "0.5rem", color: "var(--text-faint)" }}>
                Heads up: the jaludev calculator is also for Payon Stories, but it's <strong>no longer kept up to
                date</strong>, so it can be missing recent reworks — your damage here may differ from what it showed.
                This calc uses the current PS formulas.
              </p>
              <textarea
                rows={3}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://payonrocalc.jaludev.com/#..."
                spellCheck={false}
                style={{ fontFamily: "var(--mono)", fontSize: "0.78rem" }}
              />
              {err && <p className="error-text">{err}</p>}
              <div className="field-row" style={{ marginTop: "0.6rem" }}>
                <button className="primary" onClick={doImport} disabled={busy || !url.trim()}>
                  {busy ? "Importing…" : "Import"}
                </button>
                <button className="ghost" onClick={close}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
