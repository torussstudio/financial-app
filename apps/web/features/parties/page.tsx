import { Search, ArrowUpRight, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function PartiesPage({ ctx }: Props) {
  const { page, data, money, pretty, go, setPartyFilter, Empty, search, setSearch, Badge, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "parties" && <section className="panel">
      <div className="panel-toolbar">
        <h2>Contacts <span className="count">{data.parties.length}</span></h2>
        <div className="searchbox">
          <Search size={15}/>
          <input placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {filter(data.parties).map((p: Row) => <tr key={p.id}>
              <td>
                <div className="cell-title">
                  <span className="letter-avatar">{p.name[0]}</span>
                  <strong>{p.name}</strong>
                </div>
              </td>
              <td>{p.email || "—"}<small>{p.phone}</small></td>
              <td><Badge tone="gray">{pretty(p.kind)}</Badge></td>
              <td className="right amount">{money(p.receivable)}</td>
              <td className="right amount">{money(p.payable)}</td>
              <td>
                <button className="link small" onClick={() => {
    setPartyFilter(p.id);
    go("vouchers")
  }}>View activity <ArrowUpRight size={13}/>
                </button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!data.parties.length && <Empty label="Add your first contact"/>}
    </section>}</>;
}
