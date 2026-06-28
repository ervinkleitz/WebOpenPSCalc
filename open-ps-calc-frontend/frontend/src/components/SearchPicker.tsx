import { useEffect, useRef, useState } from "react";
import { SearchResult } from "../types";

interface Props {
  placeholder: string;
  search: (query: string) => Promise<SearchResult[]>;
  onSelect: (result: SearchResult) => void;
}

export default function SearchPicker({ placeholder, search, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      search(query).then((rows) => {
        setResults(rows);
        setActiveIndex(-1);
        setOpen(true);
      }).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, search]);

  // Scroll the keyboard-focused item into view inside the results list.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Returns the next non-disabled index in direction +1 or -1, or -1 if none.
  function findEnabled(from: number, dir: 1 | -1): number {
    let i = from + dir;
    while (i >= 0 && i < results.length) {
      if (!results[i].disabled) return i;
      i += dir;
    }
    return -1;
  }

  function selectResult(r: SearchResult) {
    if (r.disabled) return;
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && results.length > 0) {
        const first = findEnabled(-1, 1);
        setOpen(true);
        setActiveIndex(first);
        return;
      }
      if (open && results.length > 0) {
        const next = findEnabled(activeIndex, 1);
        if (next >= 0) setActiveIndex(next);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) {
        const prev = findEnabled(activeIndex, -1);
        setActiveIndex(prev);
      }
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && !results[activeIndex]?.disabled) {
        e.preventDefault();
        selectResult(results[activeIndex]);
      }
    } else if (e.key === "Tab") {
      if (open && activeIndex >= 0 && !results[activeIndex]?.disabled) {
        selectResult(results[activeIndex]);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="search-combo" ref={boxRef}>
      <input
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (results.length > 0) { setOpen(true); return; }
          if (!query.trim()) {
            search("").then((rows) => { setResults(rows); setActiveIndex(-1); setOpen(rows.length > 0); }).catch(() => {});
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {open && results.length > 0 && (
        <div className="search-results" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`search-result-item${i === activeIndex ? " active" : ""}${r.disabled ? " disabled" : ""}`}
              onClick={() => selectResult(r)}
            >
              <span>{r.label}</span>
              <span className="id">{r.sublabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
