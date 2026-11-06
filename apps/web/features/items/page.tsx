import { useState } from "react";
import { Search } from "lucide-react";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function ItemsPage({ ctx }: Props) {
  const { data, money, canWrite, open, Empty, search, setSearch, Badge } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  const [showArchived, setShowArchived] = useState(false);
  const items: Row[] = filter(data.items || []).filter((i: Row) => showArchived || !i.archived);
  const archivedCount = (data.items || []).filter((i: Row) => i.archived).length;
  return <section className="panel">
    <div className="panel-toolbar">
      <h2>Products & services <span className="count">{(data.items || []).length - archivedCount}</span></h2>
      <div className="searchbox">
        <Search size={15}/>
        <input placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>
      {archivedCount > 0 && <label className="check-field"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Show archived ({archivedCount})</label>}
    </div>
    {items.length ? <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>HSN / SAC</th>
            <th className="right">Default rate</th>
            <th className="right">GST</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map(i => <tr key={i.id}>
            <td><strong>{i.name}</strong>{i.description && <small>{i.description}</small>}</td>
            <td><Badge tone={i.archived ? "gray" : i.kind === "GOODS" ? "blue" : ""}>{i.archived ? "Archived" : i.kind === "GOODS" ? "Goods" : "Service"}</Badge></td>
            <td className="mono">{i.hsn || "—"}</td>
            <td className="right amount">{Number(i.rate) > 0 ? money(i.rate) + (i.unit ? " / " + i.unit : "") : "—"}</td>
            <td className="right">{Number(i.tax_rate)}%</td>
            <td className="right">{canWrite && <button className="link small" onClick={() => open("item", { item: i })}>Edit</button>}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : <Empty label="No products or services yet" detail="Add what you sell once; then pick it on any quotation, invoice or vendor bill line."/>}
    <div className="panel-note">On a document line, start typing an item's name and choose it to fill its HSN / SAC, rate and GST %.</div>
  </section>;
}
