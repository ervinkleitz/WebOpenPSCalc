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

  function selectResult(r: SearchResult) {
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && results.length > 0) { setOpen(true); setActiveIndex(0); return; }
      if (open && results.length > 0) setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0) { e.preventDefault(); selectResult(results[activeIndex]); }
    } else if (e.key === "Tab") {
      // Select focused item on Tab; let the event propagate so focus moves normally.
      if (open && activeIndex >= 0) selectResult(results[activeIndex]);
      else setOpen(false);
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
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && results.length > 0 && (
        <div className="search-results" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`search-result-item${i === activeIndex ? " active" : ""}`}
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
