import { useEffect, useMemo, useState } from "react";
type Row = Record<string, any>;
// Client-side sort + pagination shared by the data tables. Resets to page 1 whenever the row set changes size.
export function useTable(rows: Row[], pageSize = 25, initial?: { key: string; dir: "asc" | "desc" }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initial ?? null);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length, sort?.key, sort?.dir]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const k = sort.key, m = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[k], y = b[k], nx = Number(x), ny = Number(y);
      if (x != null && y != null && x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny)) return (nx - ny) * m;
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * m;
    });
  }, [rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const toggle = (key: string) => setSort(s => !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null);
  return { rows: sorted.slice(cur * pageSize, cur * pageSize + pageSize), sort, toggle, page: cur, pages, setPage, total: sorted.length, pageSize };
}
