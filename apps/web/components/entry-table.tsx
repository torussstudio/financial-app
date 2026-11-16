import { ArrowUpRight, ArrowDownLeft, Paperclip, Printer } from "lucide-react";
import { Badge, Empty } from "./ui";
import { ActionButton } from "./action-button";
import { useTable } from "../lib/use-table";
import { Pager, SortTh } from "./pager";
import { day, money, pretty, type Row } from "../lib/format";
const OUT = ["EXPENSE", "REIMBURSEMENT", "ASSET", "PAYMENT", "CREDIT_NOTE", "PURCHASE"];
export function EntryTable({ rows, compact = false, canWrite, onReceipt, onReverse, onAttach, attachmentCounts = {} }: {
  rows: Row[];
  compact?: boolean;
  canWrite: boolean;
  onReceipt: (id: string) => void | Promise<void>;
  onReverse: (entry: Row) => void;
  onAttach?: (entry: Row) => void;
  attachmentCounts?: Record<string, number>;
}) {
  const t = useTable(rows, compact ? 1000 : 25);
  return rows.length ? <><div className="table-scroll">
    <table>
      <thead>
        <tr>
          {compact ? <><th>Transaction</th><th>Date</th><th>Type</th><th className="right">Amount</th></> : <>
            <SortTh label="Transaction" k="description" sort={t.sort} toggle={t.toggle}/>
            <SortTh label="Date" k="entry_date" sort={t.sort} toggle={t.toggle}/>
            <th>Type</th>
            <SortTh label="Amount" k="amount" className="right" sort={t.sort} toggle={t.toggle}/></>}
          {!compact && <th className="right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {t.rows.map(e => <tr key={e.id}>
          <td data-label="Transaction">
            <div className="cell-title">
              <span className={"entry-icon " + (OUT.includes(e.kind) ? "out" : "")}>
                {OUT.includes(e.kind) ? <ArrowUpRight size={16}/> : <ArrowDownLeft size={16}/>}
              </span>
              <div>
                <strong>{e.description}</strong>
                <small>{e.number}{e.party_name ? " · " + e.party_name : ""}</small>
              </div>
            </div>
          </td>
          <td className="muted nowrap">{day(e.entry_date)}</td>
          <td>
            <Badge tone={["EXPENSE", "REIMBURSEMENT", "ASSET", "PURCHASE"].includes(e.kind) ? "amber" : e.kind.includes("CAPITAL") ? "blue" : ""}>
              {e.reversed_by ? "Reversed" : e.kind === "PURCHASE" ? "Vendor bill" : e.kind === "PAYMENT" ? "Vendor payment" : pretty(e.kind)}
            </Badge>
          </td>
          <td className="right amount">{money(e.amount)}</td>
          {!compact && <td className="right">
            <div className="row-actions">
              {onAttach && <button className="icon-btn attach-btn" title="Attachments" onClick={() => onAttach(e)}>
                <Paperclip size={15}/>{attachmentCounts[e.document_id || e.id] ? <span>{attachmentCounts[e.document_id || e.id]}</span> : null}
              </button>}
              {["RECEIPT", "PAYMENT"].includes(e.kind) && <ActionButton className="icon-btn" title="View receipt" onClick={() => onReceipt(e.id)}>
                <Printer size={15}/>
              </ActionButton>}
              {canWrite && !e.document_id && !e.reversal_of && !e.reversed_by && <button className="link small" onClick={() => onReverse(e)}>Reverse</button>}
            </div>
          </td>}
        </tr>)}
      </tbody>
    </table>
  </div><Pager {...t}/></> : <Empty />;
}
