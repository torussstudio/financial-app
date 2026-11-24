import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Row } from "../../lib/format";
import { exportLedgerPdf } from "./ledger-pdf";
type Props = {
  ctx: any
};
const KIND_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const cents = (v: any) => Math.round(Number(v || 0) * 100);
export function LedgerPage({ ctx }: Props) {
  const { page, data, money, day, from, to, api, pretty, isAdmin, removeEntry, partyFilter, bankLabel } = ctx;
  const accounts: Row[] = data?.accounts || [];
  const [account, setAccount] = useState("");
  const [ledger, setLedger] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const selected = account || (partyFilter ? "ALL" : accounts.find(a => a.is_cash)?.code || accounts[0]?.code || "");
  const allMode = selected === "ALL";
  useEffect(() => {
    if (page !== "ledger" || !selected) return;
    let live = true;
    setBusy(true);
    setFailed("");
    api("ledger?account=" + encodeURIComponent(selected) + "&from=" + from + "&to=" + to + (partyFilter ? "&partyId=" + encodeURIComponent(partyFilter) : ""))
      .then((r: Row) => { if (live) setLedger(r) })
      .catch((e: any) => { if (live) { setLedger(null); setFailed(e?.message || "Couldn't load this ledger.") } })
      .finally(() => { if (live) setBusy(false) });
    return () => { live = false };
  }, [page, selected, from, to, partyFilter, data, api]);
  const view = useMemo(() => {
    if (!ledger || ledger.account?.code !== selected) return null;
    let running = allMode ? 0 : cents(ledger.opening);
    let debit = 0, credit = 0;
    const rows = (ledger.rows as Row[]).map(r => {
      const d = cents(r.debit), c = cents(r.credit);
      debit += d; credit += c; running += d - c;
      return { ...r, running };
    });
    return { rows, debit, credit, opening: allMode ? 0 : cents(ledger.opening), closing: running };
  }, [ledger, selected, allMode]);
  if (page !== "ledger") return null;
  const side = (n: number) => money(Math.abs(n) / 100) + (n === 0 ? "" : n > 0 ? " Dr" : " Cr");
  const partyName = partyFilter ? (data?.parties || []).find((p: Row) => p.id === partyFilter)?.name : "";
  const grouped = KIND_ORDER.map(k => [k, accounts.filter(a => a.kind === k)] as const).filter(([, list]) => list.length);
  const other = accounts.filter(a => !KIND_ORDER.includes(a.kind));
  return <section className="panel">
    <div className="panel-heading">
      <div><h2>{allMode ? "All accounts" : ledger?.account ? (accounts.find(a => a.code === ledger.account.code && a.is_cash) ? bankLabel(ledger.account) : ledger.account.name) : "Account ledger"}</h2><p>Every posted line on one account, with a running balance · {day(from)} to {day(to)}{partyName ? " · " + partyName : ""}</p></div>
      <div className="panel-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select aria-label="Ledger account" value={selected} onChange={e => setAccount(e.target.value)}>
          <option value="ALL">All accounts{partyName ? " · " + partyName : ""}</option>
          {grouped.map(([k, list]) => <optgroup key={k} label={pretty(k)}>
            {list.map(a => <option key={a.code} value={a.code}>{a.code} · {a.is_cash ? bankLabel(a) : a.name}</option>)}
          </optgroup>)}
          {other.length > 0 && <optgroup label="Other">{other.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</optgroup>}
        </select>
        <button className="btn" disabled={!view?.rows.length} onClick={() => {
          if (!view || !ledger) return;
          const title = allMode ? "All accounts" : (accounts.find(a => a.code === ledger.account.code && a.is_cash) ? bankLabel(ledger.account) : ledger.account.name);
          exportLedgerPdf({
            company: data?.company || {}, title, accountCode: selected, allMode, partyName,
            party: partyFilter ? (data?.parties || []).find((p: Row) => p.id === partyFilter) || null : null, from, to,
            rows: view.rows, opening: view.opening, closing: view.closing, debit: view.debit, credit: view.credit,
            money, day, fileName: "Ledger - " + title + " - " + from + " to " + to
          });
        }}><Download size={15} />Export PDF</button>
      </div>
    </div>
    {failed ? <div className="error" role="alert">{failed}</div> : !view ? (busy ? <div className="skel-rows" role="status" aria-label="Loading ledger"><i/><i/><i/><i/><i/><i/></div> : <p className="fine">Choose an account to see its ledger.</p>) : <div className="table-scroll" style={{ opacity: busy ? .6 : 1, transition: "opacity .2s" }}>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Voucher</th>
            {allMode && <th>Account</th>}
            <th>Description</th>
            <th className="right">Debit</th>
            <th className="right">Credit</th>
            {!allMode && <th className="right">Balance</th>}
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {!allMode && <tr>
            <td colSpan={5}><strong>Opening balance</strong><small> as of {day(from)}</small></td>
            <td className="right amount"><strong>{side(view.opening)}</strong></td>
            {isAdmin && <td />}
          </tr>}
          {view.rows.map((r: Row, i: number) => <tr key={r.id + "-" + i}>
            <td>{day(r.entry_date)}</td>
            <td>{r.number}</td>
            {allMode && <td>{r.account_code} · {r.account_name}</td>}
            <td><strong>{r.description}</strong>{r.party_name && <small>{r.party_name}</small>}</td>
            <td className="right amount">{cents(r.debit) ? money(r.debit) : ""}</td>
            <td className="right amount">{cents(r.credit) ? money(r.credit) : ""}</td>
            {!allMode && <td className="right amount">{side(r.running)}</td>}
            {isAdmin && <td className="right"><button className="link small danger-link" onClick={() => removeEntry(r)}>Delete</button></td>}
          </tr>)}
          {!view.rows.length && <tr><td colSpan={allMode ? 6 : 6}><small>No entries {allMode ? "" : "on this account "}in the selected period{partyName ? " for " + partyName : ""}.</small></td></tr>}
          <tr>
            <td colSpan={allMode ? 4 : 3}><strong>Period total</strong></td>
            <td className="right amount"><strong>{money(view.debit / 100)}</strong></td>
            <td className="right amount"><strong>{money(view.credit / 100)}</strong></td>
            {!allMode && <td />}
            {isAdmin && <td />}
          </tr>
          {!allMode && <tr>
            <td colSpan={5}><strong>Closing balance</strong><small> as of {day(to)}</small></td>
            <td className="right amount"><strong>{side(view.closing)}</strong></td>
            {isAdmin && <td />}
          </tr>}
        </tbody>
      </table>
    </div>}
  </section>;
}
