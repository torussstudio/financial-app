import { ArrowUpRight, ArrowDownLeft, Printer } from "lucide-react";
import { Badge, Empty } from "./ui";
import { ActionButton } from "./action-button";
import { day, money, pretty, type Row } from "../lib/format";
export function EntryTable({ rows, compact = false, canWrite, onReceipt, onReverse }: {
  rows: Row[];
  compact?: boolean;
  canWrite: boolean;
  onReceipt: (id: string) => void | Promise<void>;
  onReverse: (entry: Row) => void;
}) {
  return rows.length ? <div className="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Transaction</th>
          <th>Date</th>
          <th>Type</th>
          <th className="right">Amount</th>
          {!compact && <th className="right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(e => <tr key={e.id}>
          <td>
            <div className="cell-title">
              <span className={"entry-icon " + (["EXPENSE", "REIMBURSEMENT", "ASSET", "PAYMENT", "CREDIT_NOTE"].includes(e.kind) ? "out" : "")}>
                {["EXPENSE", "REIMBURSEMENT", "ASSET", "PAYMENT", "CREDIT_NOTE"].includes(e.kind) ? <ArrowUpRight size={16}/> : <ArrowDownLeft size={16}/>}
              </span>
              <div>
                <strong>{e.description}</strong>
                <small>{e.number}{e.party_name ? " · " + e.party_name : ""}</small>
              </div>
            </div>
          </td>
          <td className="muted nowrap">{day(e.entry_date)}</td>
          <td>
            <Badge tone={["EXPENSE", "REIMBURSEMENT", "ASSET"].includes(e.kind) ? "amber" : e.kind.includes("CAPITAL") ? "blue" : ""}>
              {e.reversed_by ? "Reversed" : pretty(e.kind)}
            </Badge>
          </td>
          <td className="right amount">{money(e.amount)}</td>
          {!compact && <td className="right">
            <div className="row-actions">
              {["RECEIPT", "PAYMENT"].includes(e.kind) && <ActionButton className="icon-btn" title="View receipt" onClick={() => onReceipt(e.id)}>
                <Printer size={15}/>
              </ActionButton>}
              {canWrite && !e.document_id && !e.reversal_of && !e.reversed_by && <button className="link small" onClick={() => onReverse(e)}>Reverse</button>}
            </div>
          </td>}
        </tr>)}
      </tbody>
    </table>
  </div> : <Empty />;
}
