import { useState, useEffect } from "react";
import { api } from "../api/client";

// Two very different links land in the same box, because a player pasting a build
// should not have to know which kind they have.
//
//   payonrocalc.jaludev.com/#...          a whole build  -> REPLACES what's on screen
//   tools.payonstories.com/skill?state=…  skills only    -> MERGES into what's on screen
//
// The second carries no stats and no gear, so replacing the build would throw away
// equipment the player set up here. Hence the split.
type LinkKind = "jaludev" | "ps-tools";

export function detectLinkKind(url: string): LinkKind {
  const u = url.trim();
  if (/tools\.payonstories\.com/i.test(u) || /[?&#]state=/.test(u)) return "ps-tools";
  return "jaludev";
}

type SkillImport = {
  job_id: number; job_name: string;
  mastery_levels: Record<string, number>;
  applied: { constant: string; display: string; level: number; requested?: number }[];
  not_modelled: { constant: string; display: string; level: number }[];
  off_tree_count: number;
};

interface Props {
  open: boolean;
  onClose: () => void;
  server: string;
  // A whole build from jaludev. Called before any "unmapped" list is shown.
  onImported: (build: any, unmapped: string[]) => void;
  // Job + skill levels from PS's planner, merged into the build on screen.
  onSkillsImported: (result: SkillImport) => void;
}

export default function ImportBuildModal({ open, onClose, server, onImported, onSkillsImported }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unmapped, setUnmapped] = useState<string[] | null>(null);
  const [skills, setSkills] = useState<SkillImport | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const reset = () => { setUrl(""); setErr(""); setUnmapped(null); setSkills(null); };
  const close = () => { reset(); onClose(); };

  async function doImport() {
    setBusy(true);
    setErr("");
    try {
      if (detectLinkKind(url) === "ps-tools") {
        const res = await api.importPsToolsSkills(url.trim(), server);
        onSkillsImported(res);
        setSkills(res); // keep open: the player needs to see what was and wasn't taken
      } else {
        const res = await api.importJaludev(url.trim(), server);
        onImported(res.build, res.unmapped || []);
        if (res.unmapped && res.unmapped.length) setUnmapped(res.unmapped);
        else close();
      }
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
          <h2>Import a build</h2>
          <button onClick={close} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {skills ? (
            <>
              <p className="hint-text" style={{ marginTop: 0 }}>
                Skills imported for <strong>{skills.job_name.replace(/_/g, " ")}</strong>. Your stats, gear and cards
                were left as they were — this link only carries a skill tree.
              </p>
              {skills.applied.length > 0 ? (
                <ul className="import-unmapped">
                  {skills.applied.map((a) => (
                    <li key={a.constant}>
                      {a.display} <strong>Lv{a.level}</strong>
                      {a.requested != null && (
                        <span className="hint-text"> — capped from Lv{a.requested}, the max here is {a.level}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="error-text">
                  None of the skills in that link affect damage here, so nothing changed.
                </p>
              )}
              {skills.not_modelled.length > 0 && (
                <p className="hint-text" style={{ marginTop: "0.6rem", color: "var(--text-faint)" }}>
                  Also on your tree but not used by any damage formula here, so left out:{" "}
                  {skills.not_modelled.map((s) => `${s.display} Lv${s.level}`).join(", ")}.
                </p>
              )}
              {skills.off_tree_count > 0 && (
                <p className="hint-text" style={{ marginTop: "0.4rem", color: "var(--text-faint)" }}>
                  {skills.off_tree_count} skill{skills.off_tree_count === 1 ? "" : "s"} from other classes
                  {skills.off_tree_count === 1 ? " was" : " were"} ignored — the PS planner lists every quest skill
                  whatever class you pick.
                </p>
              )}
              <div className="field-row" style={{ marginTop: "0.6rem" }}>
                <button className="primary" onClick={close}>Done</button>
              </div>
            </>
          ) : unmapped ? (
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
                Paste a link from <strong>tools.payonstories.com/skill</strong> to bring in a skill tree, or from{" "}
                <strong>payonrocalc.jaludev.com</strong> to bring in a whole build. Either one is recognised
                automatically.
              </p>
              <p className="hint-text" style={{ marginTop: "0.5rem", color: "var(--text-faint)" }}>
                A PS planner link carries <strong>only skills</strong>, so your stats and gear here are kept and just
                the skill levels are filled in — anything the link doesn't mention keeps the level it has now. A
                jaludev link carries a whole build and <strong>replaces</strong> what's on screen — and since that
                calculator is no longer kept up to date, its numbers can be missing recent reworks.
              </p>
              <textarea
                rows={3}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://tools.payonstories.com/skill?state=…"
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
