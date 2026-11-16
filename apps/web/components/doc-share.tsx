import { Mail, MessageCircle, Check, Circle } from "lucide-react";
type Row = Record<string, any>;
// Share links + a status timeline shown above the document preview (never printed).
export function DocShare({ d, company, money, outstandingOf, today }: { d: Row; company: Row; money: (v: any) => string; outstandingOf: (d: Row) => number; today: string }) {
  if (!d?.number) return null;
  const who = d.client_snapshot?.name || d.party_name || "";
  const label = String(d.kind).replace(/_/g, " ").toLowerCase();
  const total = money(d.total);
  const due = d.due_date ? String(d.due_date).slice(0, 10) : "";
  const text = `Hello ${who}, please find ${label} ${d.number} from ${company?.name || "us"} for ${total}${due ? ", due " + due : ""}. Thank you.`;
  const phone = String(d.client_snapshot?.phone || "").replace(/\D/g, "");
  const wa = "https://wa.me/" + (phone.length === 10 ? "91" + phone : phone) + "?text=" + encodeURIComponent(text);
  const mail = "mailto:?subject=" + encodeURIComponent(`${label} ${d.number} from ${company?.name || ""}`) + "&body=" + encodeURIComponent(text);
  const issued = d.status === "ISSUED" || d.status === "CANCELLED";
  const out = d.status === "ISSUED" ? outstandingOf(d) : 0;
  const paid = d.status === "ISSUED" && Number(d.total) > 0 && out <= 0;
  const overdue = d.status === "ISSUED" && out > 0 && due && due < today;
  const steps: { t: string; on: boolean; warn?: boolean }[] = [
    { t: "Draft", on: true },
    { t: d.issue_date && issued ? "Issued " + String(d.issue_date).slice(0, 10) : "Issued", on: issued },
    ...(d.status === "CANCELLED" ? [{ t: "Cancelled", on: true, warn: true }] : [
      { t: overdue ? "Overdue since " + due : due ? "Due " + due : "Due", on: Boolean(overdue), warn: Boolean(overdue) },
      { t: paid ? "Paid" : Number(d.paid) > 0 ? "Part paid" : "Paid", on: paid || Number(d.paid) > 0 }])
  ];
  return <div className="doc-share no-print">
    <ol className="doc-timeline">{steps.map((s, i) => <li key={i} className={(s.on ? "on " : "") + (s.warn ? "warn" : "")}>{s.on ? <Check size={13}/> : <Circle size={11}/>}{s.t}</li>)}</ol>
    <span className="doc-share-actions">
      <a className="btn small-btn" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={14}/>WhatsApp</a>
      <a className="btn small-btn" href={mail}><Mail size={14}/>Email</a>
    </span>
  </div>;
}
