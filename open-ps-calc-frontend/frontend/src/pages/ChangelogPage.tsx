import { useEffect } from "react";
import { Link } from "react-router-dom";
import changelogRaw from "../../../../CHANGELOG.md?raw";

/**
 * ChangelogPage — what changed, one line per change.
 *
 * This replaced a modal that rendered every entry as a <details>: a headline you
 * could expand into the full write-up. Two problems with that. The write-ups are
 * long, because they are written to explain a fix to whoever has to maintain it —
 * which number moved, why, what the source says — and a player scanning for "is the
 * thing I reported in yet?" has to open each one to find out. And a modal is not
 * somewhere you can link a player to.
 *
 * So: a page at /changelog, and only the headline. Every entry in CHANGELOG.md is
 * written as `- **What changed.** then the detail`, so the bold lead IS the summary;
 * nothing has to be rewritten or generated. The detail still exists in the file and
 * in git for anyone who wants it.
 */

// A heading, or one entry's headline. That is the whole vocabulary of this page.
type Row =
  | { kind: "date"; text: string }
  | { kind: "section"; text: string }
  | { kind: "entry"; text: string };

// Enough markdown to render a headline: bold, italic, code. Links are flattened to
// their text — a headline is a summary, not a place to send someone else.
function inline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*([^*]+?)\*|`(.+?)`|\[(.+?)\]\(.+?\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i++}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<em key={`${keyPrefix}-${i++}`}>{m[2]}</em>);
    else if (m[3] !== undefined) nodes.push(<code key={`${keyPrefix}-${i++}`}>{m[3]}</code>);
    else if (m[4] !== undefined) nodes.push(m[4]);
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const plain = (t: string) => t
  .replace(/\*\*(.+?)\*\*/g, "$1")
  .replace(/\*([^*]+?)\*/g, "$1")
  .replace(/`(.+?)`/g, "$1")
  .replace(/\[(.+?)\]\(.+?\)/g, "$1");

// An entry's headline is its bold lead. A few older entries have none, so fall back
// to their first sentence rather than printing a paragraph.
function headline(first: string): string {
  const bold = first.match(/^\*\*(.+?)\*\*/);
  if (bold) return bold[1];
  const p = plain(first);
  const stop = p.indexOf(". ");
  if (stop > 0 && stop < 140) return p.slice(0, stop + 1);
  return p.length <= 140 ? p : p.slice(0, p.lastIndexOf(" ", 130)).trim() + "…";
}

function parse(src: string): Row[] {
  const rows: Row[] = [];
  for (const line of src.split("\n")) {
    if (/^## /.test(line)) rows.push({ kind: "date", text: line.slice(3).trim() });
    else if (/^### /.test(line)) rows.push({ kind: "section", text: line.slice(4).trim() });
    else if (/^- /.test(line)) rows.push({ kind: "entry", text: headline(line.slice(2)) });
    // Everything else is an entry's continuation, the file's preamble, or blank.
    // All three are detail, and detail is what this page leaves out.
  }
  return rows;
}

export default function ChangelogPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Changelog — Open PS Calc";
    return () => { document.title = prev; };
  }, []);

  const rows = parse(changelogRaw);
  const dates = rows.filter((r) => r.kind === "date").length;
  const entries = rows.filter((r) => r.kind === "entry").length;

  return (
    <div className="page changelog-page">
      <div className="changelog-page-head">
        <div>
          <h1>Changelog</h1>
          <p className="changelog-page-sub">
            {entries} changes across {dates} days. Newest first.
          </p>
        </div>
        <Link className="changelog-back" to="/">← Back to the calculator</Link>
      </div>

      <div className="changelog-rows">
        {rows.map((r, i) => {
          if (r.kind === "date") return <h2 key={i} className="cl-date">{r.text}</h2>;
          if (r.kind === "section") return <h3 key={i} className="cl-section">{r.text}</h3>;
          return <p key={i} className="cl-line">{inline(r.text, `e${i}`)}</p>;
        })}
      </div>
    </div>
  );
}
