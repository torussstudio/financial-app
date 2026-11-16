"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, Users, Receipt } from "lucide-react";
type Row = Record<string, any>;
type Hit = { key: string; icon: "doc" | "party" | "entry"; title: string; sub: string; run: () => void };
export function CommandPalette({ open, onClose, documents, parties, entries, onDoc, onParty, onEntry }: {
  open: boolean; onClose: () => void; documents: Row[]; parties: Row[]; entries: Row[];
  onDoc: (id: string) => void; onParty: (id: string) => void; onEntry: (e: Row) => void;
}) {
  const [q, setQ] = useState(""), [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  const hits = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const has = (...v: any[]) => v.some(x => String(x ?? "").toLowerCase().includes(t));
    const out: Hit[] = [];
    for (const d of documents) if (has(d.number, d.party_name, d.total, d.kind) && out.length < 8)
      out.push({ key: "d" + d.id, icon: "doc", title: d.number, sub: `${d.kind} · ${d.party_name ?? ""} · ${d.total ?? ""}`, run: () => onDoc(d.id) });
    let n = 0;
    for (const p of parties) if (has(p.name, p.gstin, p.phone, p.email) && n++ < 5)
      out.push({ key: "p" + p.id, icon: "party", title: p.name, sub: p.gstin || p.phone || "Contact", run: () => onParty(p.id) });
    n = 0;
    for (const e of entries) if (has(e.number, e.description, e.amount) && n++ < 6)
      out.push({ key: "e" + e.id, icon: "entry", title: e.description || e.number, sub: `${e.entry_date ?? ""} · ${e.number ?? ""} · ${e.amount ?? ""}`, run: () => onEntry(e) });
    return out;
  }, [q, documents, parties, entries, onDoc, onParty, onEntry]);
  if (!open) return null;
  const pick = (h?: Hit) => { if (h) { onClose(); h.run(); } };
  const Icon = { doc: FileText, party: Users, entry: Receipt };
  return <div className="cmdk-backdrop" onMouseDown={onClose}>
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={e => e.stopPropagation()}>
      <div className="cmdk-input"><Search size={16}/>
        <input ref={input} value={q} placeholder="Search documents, clients, entries…" aria-label="Search"
          onChange={e => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={e => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") pick(hits[idx]);
          }}/>
        <kbd>Esc</kbd>
      </div>
      <div className="cmdk-list">
        {!q.trim() && <p className="cmdk-empty">Type an invoice number, client name, GSTIN or amount.</p>}
        {q.trim() && !hits.length && <p className="cmdk-empty">No matches in the loaded date range. Widen the dates and try again.</p>}
        {hits.map((h, i) => { const I = Icon[h.icon]; return <button key={h.key} className={"cmdk-item" + (i === idx ? " active" : "")} onMouseEnter={() => setIdx(i)} onClick={() => pick(h)}>
          <I size={15}/><span><strong>{h.title}</strong><small>{h.sub}</small></span></button>; })}
      </div>
    </div>
  </div>;
}
