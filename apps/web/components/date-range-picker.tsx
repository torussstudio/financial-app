import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

type Preset = { label: string; apply: () => void };
// A date-range button that opens From/To inputs and the quick presets. Shared by Overview and Documents.
export function DateRangePicker({ from, to, setFrom, setTo, presets, day, className = "" }: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  presets?: Preset[];
  day: (s: string) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return <div className={"docs-range " + className} ref={ref}>
    <button className="docs-control" aria-expanded={open} onClick={() => setOpen(o => !o)}><CalendarDays size={14}/>{day(from)} – {day(to)}<ChevronDown size={13}/></button>
    {open && <div className="docs-pop" role="dialog" aria-label="Date range">
      <div className="docs-pop-dates">
        <label><span>From</span><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}/></label>
        <label><span>To</span><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}/></label>
      </div>
      {presets?.length ? <div className="docs-pop-presets">{presets.map(p => <button key={p.label} onClick={() => { p.apply(); setOpen(false); }}>{p.label}</button>)}</div> : null}
    </div>}
  </div>;
}
