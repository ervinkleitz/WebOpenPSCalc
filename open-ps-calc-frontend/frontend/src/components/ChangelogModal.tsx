import { useEffect } from "react";
import changelogRaw from "../../../../CHANGELOG.md?raw";

interface Props {
  open: boolean;
  onClose: () => void;
}

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*([^*]+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<em key={`${keyPrefix}-${i++}`}>{match[2]}</em>);
    else if (match[3] !== undefined) nodes.push(<code key={`${keyPrefix}-${i++}`}>{match[3]}</code>);
    else if (match[4] !== undefined) nodes.push(<a key={`${keyPrefix}-${i++}`} href={match[5]} target="_blank" rel="noreferrer">{match[4]}</a>);
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Strip markdown syntax to get plain readable text for use in summaries.
function toPlain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*]+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

// Extract a short summary from an item that has no leading **Title**.
// Cuts at the first ". " or " — " or after ~80 chars, whichever comes first.
function truncateSummary(text: string): string {
  const plain = toPlain(text);
  const dotAt  = plain.indexOf(". ");
  const dashAt = plain.indexOf(" — ");
  const natural = Math.min(
    dotAt  >= 0 ? dotAt  + 1 : Infinity,
    dashAt >= 0 ? dashAt     : Infinity,
  );
  if (natural < plain.length && natural <= 120) return plain.slice(0, natural).trim() + "…";
  if (plain.length <= 100) return plain;
  const cut = plain.lastIndexOf(" ", 90);
  return plain.slice(0, cut > 0 ? cut : 90).trim() + "…";
}

// A list item is its "- " line plus every following line indented by two spaces,
// blank lines included so long as indented content resumes after them. Splitting
// that into blocks is what keeps a bullet's trailing paragraph inside the bullet.
// The old parser stopped at the first blank line, so every indented line after it
// fell through to the bare-paragraph branch at the bottom of renderMarkdown - one
// <p> per source line, which is why long entries rendered hard-wrapped mid-sentence
// outside the entry they belong to. Nested bullets were flattened into the parent's
// body as literal "- " text for the same reason.
type ItemBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

function parseItemBlocks(cont: string[]): ItemBlock[] {
  const blocks: ItemBlock[] = [];
  let para: string[] = [];
  let bullets: string[] | null = null;
  const flushPara = () => {
    if (para.length) { blocks.push({ kind: "p", text: para.join(" ") }); para = []; }
  };
  const flushBullets = () => {
    if (bullets) { blocks.push({ kind: "ul", items: bullets }); bullets = null; }
  };
  for (const line of cont) {
    if (!line.trim()) { flushPara(); flushBullets(); continue; }
    const bullet = line.match(/^- (.*)$/);
    if (bullet) { flushPara(); (bullets ||= []).push(bullet[1]); continue; }
    // Indented under a nested bullet, so it continues that bullet rather than
    // starting a paragraph of its own.
    if (bullets) { bullets[bullets.length - 1] += " " + line.trim(); continue; }
    para.push(line.trim());
  }
  flushPara();
  flushBullets();
  return blocks;
}

interface Item { first: string; cont: string[]; }

function renderMarkdown(src: string) {
  const lines = src.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: Item[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    const items = listBuffer.slice();
    listBuffer = [];
    blocks.push(
      <div key={`list-${key++}`} className="cl-list">
        {items.map((item, i) => {
          const boldMatch = item.first.match(/^\*\*(.+?)\*\*/);
          const title = boldMatch ? boldMatch[1] : truncateSummary(item.first);
          const lead = boldMatch
            ? item.first.replace(/^\*\*(.+?)\*\*\s*(?:—\s*)?/, "").trim()
            : item.first;
          const body = parseItemBlocks(lead ? [lead, "", ...item.cont] : item.cont);
          return (
            <details key={i} className="cl-entry">
              <summary className="cl-entry-summary">{title}</summary>
              {body.length > 0 && (
                <div className="cl-entry-body">
                  {body.map((b, j) =>
                    b.kind === "p" ? (
                      <p key={j}>{renderInline(b.text, `body-${key}-${i}-${j}`)}</p>
                    ) : (
                      <ul key={j} className="cl-sublist">
                        {b.items.map((t, k) => (
                          <li key={k}>{renderInline(t, `sub-${key}-${i}-${j}-${k}`)}</li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              )}
            </details>
          );
        })}
      </div>,
    );
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^- /.test(line)) {
      const cont: string[] = [];
      while (idx + 1 < lines.length) {
        const next = lines[idx + 1];
        if (/^\s{2,}\S/.test(next)) { cont.push(next.slice(2)); idx++; continue; }
        // A blank line stays inside the item only if the item resumes after it.
        if (next.trim() === "" && /^\s{2,}\S/.test(lines[idx + 2] ?? "")) {
          cont.push(""); idx++; continue;
        }
        break;
      }
      listBuffer.push({ first: line.slice(2), cont });
      continue;
    }
    flushList();
    if (/^### /.test(line)) blocks.push(<h4 key={key++}>{line.slice(4)}</h4>);
    else if (/^## /.test(line)) blocks.push(<h3 key={key++}>{line.slice(3)}</h3>);
    else if (/^# /.test(line)) continue;
    else if (line.trim() === "") continue;
    else blocks.push(<p key={key++}>{renderInline(line, `p-${key}`)}</p>);
  }
  flushList();
  return blocks;
}

export default function ChangelogModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card changelog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Changelog</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body changelog-body">
          {renderMarkdown(changelogRaw)}
        </div>
      </div>
    </div>
  );
}
