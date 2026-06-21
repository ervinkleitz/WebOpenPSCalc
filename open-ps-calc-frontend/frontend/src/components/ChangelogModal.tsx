import { useEffect } from "react";
import changelogRaw from "../../../../CHANGELOG.md?raw";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Minimal parser for the specific markdown subset CHANGELOG.md actually
// uses (#/##/### headings, "- " bullets with indented continuation lines,
// **bold**, `code`, [text](url) links, blank-line paragraphs) -- avoids
// pulling in a full markdown library for one file.
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

function renderMarkdown(src: string) {
  const lines = src.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`}>
        {listBuffer.map((item, i) => <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>)}
      </ul>,
    );
    listBuffer = [];
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
    else if (/^# /.test(line)) continue; // modal header already shows the "# Changelog" title
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
