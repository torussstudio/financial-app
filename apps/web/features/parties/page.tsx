import { useState } from "react";
import { Search, ArrowUpRight, } from "lucide-react";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function PartiesPage({ ctx }: Props) {
  const { page, data, money, pretty, go, setPartyFilter, Empty, search, setSearch, Badge, canWrite, open } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  const [showArchived, setShowArchived] = useState(false);
  if (page !== "parties") return null;
  const archivedCount = data.parties.filter((p: Row) => p.archived).length;
  const rows: Row[] = filter(data.parties).filter((p: Row) => showArchived || !p.archived);
  return <section className="panel">
      <div className="panel-toolbar">
        <h2>Contacts <span className="count">{data.parties.length - archivedCount}</span></h2>
        <div className="searchbox">
          <Search size={15}/>
          <input placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        {archivedCount > 0 && <label className="check-field"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Show archived ({archivedCount})</label>}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Type</th>
              <th className="right">Receivable</th>
              <th className="right">Payable</th>
              <th className="right">Advance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p: Row) => {
              const received = Number(p.advance_received), paid = Number(p.advance_paid);
              return <tr key={p.id} className={p.archived ? "archived-row" : ""}>
              <td>
                <div className="cell-title">
                  <span className="letter-avatar">{p.name[0]}</span>
                  <div><strong>{p.name}</strong>{p.gstin && <small className="mono">{p.gstin}</small>}</div>
                </div>
              </td>
              <td>{p.email || "—"}<small>{[p.contact_name, p.phone].filter(Boolean).join(" · ")}</small></td>
              <td><Badge tone="gray">{p.archived ? "Archived" : pretty(p.kind)}</Badge></td>
              <td className="right amount">{money(p.receivable)}</td>
              <td className="right amount">{money(p.payable)}</td>
              <td className="right amount">
                {received > 0 || paid > 0 ? <>{received > 0 && <span title="Received from client, not yet applied">{money(received)} in</span>}{paid > 0 && <small title="Paid to vendor, not yet applied">{money(paid)} out</small>}</> : "—"}
              </td>
              <td>
                <div className="row-actions">
                  {canWrite && <button className="link small" onClick={() => open("party", { party: p })}>Edit</button>}
                  {canWrite && received > 0 && <button className="link small" onClick={() => open("advance", { direction: "RECEIPT", partyId: p.id })}>Apply advance</button>}
                  {canWrite && paid > 0 && <button className="link small" onClick={() => open("advance", { direction: "PAYMENT", partyId: p.id })}>Apply advance</button>}
                  <button className="link small" onClick={() => {
                    setPartyFilter(p.id);
                    go("vouchers")
                  }}>Activity <ArrowUpRight size={13}/>
                  </button>
                </div>
              </td>
            </tr>;
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty label="Add your first contact"/>}
    </section>;
}
