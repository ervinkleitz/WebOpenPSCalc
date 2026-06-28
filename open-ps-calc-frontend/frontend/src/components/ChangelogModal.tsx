import { useEffect } from "react";
import changelogRaw from "../../../../CHANGELOG.md?raw";

interface Props {
  open: boolean;
  onClose: () => void;
}

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<code key={`${keyPrefix}-${i++}`}>{match[2]}</code>);
    else if (match[3] !== undefined) nodes.push(<a key={`${keyPrefix}-${i++}`} href={match[4]} target="_blank" rel="noreferrer">{match[3]}</a>);
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Strip markdown syntax to get plain readable text for use in summaries.
function toPlain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
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

function renderMarkdown(src: string) {
  const lines = src.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    const items = listBuffer.slice();
    listBuffer = [];
    blocks.push(
      <div key={`list-${key++}`} className="cl-list">
        {items.map((item, i) => {
          const boldMatch = item.match(/^\*\*(.+?)\*\*/);
          const title = boldMatch
            ? boldMatch[1]
            : truncateSummary(item);
          const body = boldMatch
            ? item.replace(/^\*\*(.+?)\*\*\s*(?:—\s*)?/, "").trim()
            : item;
          return (
            <details key={i} className="cl-entry">
              <summary className="cl-entry-summary">{title}</summary>
              {body && (
                <div className="cl-entry-body">
                  {renderInline(body, `body-${key}-${i}`)}
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
      let item = line.slice(2);
      while (idx + 1 < lines.length && /^\s{2,}\S/.test(lines[idx + 1])) {
        item += " " + lines[++idx].trim();
      }
      listBuffer.push(item);
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
