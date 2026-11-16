import { ChevronLeft, ChevronRight, ChevronsUpDown, ArrowUp, ArrowDown } from "lucide-react";
export function Pager({ page, pages, total, pageSize, setPage }: { page: number; pages: number; total: number; pageSize: number; setPage: (n: number) => void }) {
  if (pages <= 1) return null;
  const from = page * pageSize + 1, to = Math.min(total, (page + 1) * pageSize);
  return <div className="pager">
    <span>{from}–{to} of {total}</span>
    <button className="icon-btn" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16}/></button>
    <span>Page {page + 1} / {pages}</span>
    <button className="icon-btn" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={16}/></button>
  </div>;
}
export function SortTh({ label, k, sort, toggle, className = "" }: { label: string; k: string; sort: { key: string; dir: string } | null; toggle: (k: string) => void; className?: string }) {
  const on = sort?.key === k;
  return <th className={className} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
    <button className="sort-btn" onClick={() => toggle(k)}>{label}{on ? (sort!.dir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/>) : <ChevronsUpDown size={12}/>}</button>
  </th>;
}
