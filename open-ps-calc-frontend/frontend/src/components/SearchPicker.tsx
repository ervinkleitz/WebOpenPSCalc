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
  const boxRef = useRef<HTMLDivElement>(null);

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
        setOpen(true);
      }).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, search]);

  return (
    <div className="search-combo" ref={boxRef}>
      <input
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div
              key={r.id}
              className="search-result-item"
              onClick={() => {
                onSelect(r);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
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
