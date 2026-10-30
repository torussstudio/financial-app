"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Plus, Download, X, RefreshCw, Printer,
  AlertCircle, Clock3,
} from "lucide-react";
import { Badge, Empty, Field } from "../components/ui";
import { ToastViewport, useToasts, type ToastInput } from "../components/toast";
import { amountInWords, documentLabel, localDate, localMonthStart, voucherLabel } from "../lib/format";
import { EntryTable } from "../components/entry-table";
import { ActionButton } from "../components/action-button";
import { DocumentPreview, Report } from "../components/financial-views";
import { Header } from "../components/layout/header";
import { WorkspaceEntryModal } from "../components/modals/workspace-entry-modal";
import { LoginScreen } from "../features/auth/login-screen";
import { DashboardPage } from "../features/dashboard/page";
import { DocumentsPage } from "../features/documents/page";
import { LedgerActivityPages } from "../features/activity/page";
import { PartiesPage } from "../features/parties/page";
import { ProjectsPage } from "../features/projects/page";
import { BankPage } from "../features/bank/page";
import { ReportsPage } from "../features/reports/page";
import { BudgetsPage } from "../features/budgets/page";
import { RecurringPage } from "../features/recurring/page";
import { SettingsPage } from "../features/settings/page";
import { Sidebar, SidebarCover, navigation } from "../components/layout/sidebar";

type Row = Record<string, any>;

const today = () => localDate();

const monthStart = (offset = 0) => localMonthStart(offset);

const money = (value: any) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));

const short = (v: number) =>
  Math.abs(v) >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L"
  : Math.abs(v) >= 1000 ? "₹" + (v / 1000).toFixed(0) + "k"
  : "₹" + v;

const pretty = (s: string) =>
  s ? s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";

const day = (s: string) =>
  new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const palette = ["#26756b", "#77a99f", "#accdc4", "#d9b97d", "#e7dcc6"];

function exportCSV(rows: Row[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const value = (v: any) => {
    const s = String(v ?? "");
    return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'
  };
  const blob = new Blob(
    ["\uFEFF" + [keys.map(value).join(","), ...rows.map(r => keys.map(k => value(r[k])).join(","))].join("\r\n")],
    { type: "text/csv;charset=utf-8;" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') { cell += '"'; i++; }
      else quote = !quote;
    }
    else if (c === "," && !quote) { row.push(cell); cell = ""; }
    else if (c === "\n" && !quote) {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    }
    else cell += c;
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  if (quote) throw Error("CSV contains an unclosed quote.");
  if (rows[0]?.map(s => s.trim().toLowerCase()).join(",") !== "date,reference,description,amount")
    throw Error("Use the header: date,reference,description,amount");
  return rows.slice(1).map(r => ({
    date: r[0]?.trim(),
    reference: r[1]?.trim(),
    description: r[2] || "",
    amount: r[3]?.trim()
  }));
}

function invoiceTotals(lines: Row[], taxable: boolean, interstate: boolean | null) {
  let subtotal = 0, tax = 0, cgst = 0, sgst = 0;
  for (const line of lines) {
    const base = Math.round(Number(line.quantity || 0) * Number(line.price || 0) * 100) / 100,
      lineTax = taxable ? Math.round(base * Number(line.taxRate || 0)) / 100 : 0;
    subtotal += base;
    tax += lineTax;
    if (taxable && interstate === false) {
      const half = Math.round(lineTax / 2 * 100) / 100;
      cgst += half;
      sgst += lineTax - half;
    }
  }
  subtotal = Math.round(subtotal * 100) / 100;
  tax = Math.round(tax * 100) / 100;
  cgst = Math.round(cgst * 100) / 100;
  sgst = Math.round(sgst * 100) / 100;
  return {
    subtotal, tax, cgst, sgst,
    igst: taxable && interstate === true ? tax : 0,
    total: Math.round((subtotal + tax) * 100) / 100
  };
}

const isStateCode = (value: any) => /^\d{2}$/.test(String(value || ""));

const companyDocumentProfile = (company: Row, taxTreatment: string): Row => {
  if (taxTreatment !== "OUTSIDE_GST") return { ...company };
  const nonGstKeys = [
    "non_gst_name", "non_gst_address", "non_gst_address_line2", "non_gst_city", "non_gst_state_name",
    "non_gst_state_code", "non_gst_pin_code", "non_gst_contact_number", "non_gst_account_holder_name",
    "non_gst_bank_name", "non_gst_account_number", "non_gst_ifsc_code", "non_gst_branch_name", "non_gst_bank_details"
  ];
  if (!nonGstKeys.some(key => String(company[key] || "").trim())) return { ...company };
  return {
    ...company,
    name: company.non_gst_name || company.name,
    address: company.non_gst_address || "",
    address_line2: company.non_gst_address_line2 || "",
    city: company.non_gst_city || "",
    state_name: company.non_gst_state_name || "",
    state_code: company.non_gst_state_code || company.state_code,
    pin_code: company.non_gst_pin_code || "",
    contact_number: company.non_gst_contact_number || "",
    account_holder_name: company.non_gst_account_holder_name || "",
    bank_name: company.non_gst_bank_name || "",
    account_number: company.non_gst_account_number || "",
    ifsc_code: company.non_gst_ifsc_code || "",
    branch_name: company.non_gst_branch_name || "",
    bank_details: company.non_gst_bank_details || ""
  };
};

export default function Page() {
  const [session, setSession] = useState<Row | null>(null),
    [authReady, setAuthReady] = useState(false),
    [demoLogin, setDemoLogin] = useState(false);
  const [data, setData] = useState<Row | null>(null),
    [page, setPage] = useState("dashboard"),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const { toasts, notify, dismiss } = useToasts();
  const [from, setFrom] = useState(monthStart(-5)),
    [to, setTo] = useState(today()),
    [partyFilter, setPartyFilter] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [search, setSearch] = useState(""),
    [taxTab, setTaxTab] = useState("ALL"),
    [docKind, setDocKind] = useState("ALL"),
    [report, setReport] = useState("P&L"),
    [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<Row | null>(null),
    [preview, setPreview] = useState<Row | null>(null),
    [users, setUsers] = useState<Row[]>([]),
    [docLines, setDocLines] = useState<Row[]>([{ description: "", quantity: "1", price: "", taxRate: "18", hsn: "" }]);
  const [formKind, setFormKind] = useState("EXPENSE"),
    [paymentDoc, setPaymentDoc] = useState(""),
    [taxTreatment, setTaxTreatment] = useState("TAXABLE"),
    [newDocKind, setNewDocKind] = useState("INVOICE"),
    [placeOfSupply, setPlaceOfSupply] = useState(""),
    [manualSupplyMode, setManualSupplyMode] = useState("");
  const [docNumber, setDocNumber] = useState(""),
    [docCurrency, setDocCurrency] = useState("INR"),
    [advanceAmount, setAdvanceAmount] = useState("0"),
    [advanceStatus, setAdvanceStatus] = useState("NOT_RECEIVED"),
    [clientInfo, setClientInfo] = useState<Row>({ name: "", address: "", gstin: "", contactName: "", phone: "" }),
    [documentCompany, setDocumentCompany] = useState<Row>({}),
    [docPartyId, setDocPartyId] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const pendingRequests = useRef(new Map<string, string>());
  const loadSequence = useRef(0);

  useEffect(() => {
    const savedPage = sessionStorage.getItem("company-accounts-active-page");
    if (savedPage && navigation.some(([key]) => key === savedPage)) setPage(savedPage);
  }, []);

  useEffect(() => {
    if (modal?.type !== "document") return;
    const interstate = isStateCode(data?.company?.state_code) && isStateCode(placeOfSupply)
      ? placeOfSupply !== data?.company?.state_code
      : manualSupplyMode === "INTER" ? true
      : manualSupplyMode === "INTRA" ? false
      : null;
    const total = invoiceTotals(docLines, taxTreatment === "TAXABLE", interstate).total,
      raw = Number(advanceAmount) || 0;
    if (raw > total) {
      setAdvanceAmount(String(total));
      setAdvanceStatus(total > 0 ? "FULLY_RECEIVED" : "NOT_RECEIVED");
      return;
    }
    const next = raw <= 0 ? "NOT_RECEIVED" : raw >= total ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
    if (advanceStatus !== next) setAdvanceStatus(next);
  }, [modal?.type, docLines, taxTreatment, placeOfSupply, manualSupplyMode, data?.company?.state_code, advanceAmount, advanceStatus]);

  const api = useCallback(async (path: string, method = "GET", body?: unknown) => {
    const requestId = method + ":" + path + ":" + JSON.stringify(body);
    if (method !== "GET" && !pendingRequests.current.has(requestId))
      pendingRequests.current.set(requestId, Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""));
    const r = await fetch("/api/" + path, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(session?.csrf ? { "X-CSRF-Token": session.csrf } : {}),
        ...(method !== "GET" ? { "Idempotency-Key": pendingRequests.current.get(requestId)! } : {} )
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const j = await r.json().catch(() => ({ message: "Service unavailable." }));
    if (r.ok || (r.status >= 400 && r.status < 500)) pendingRequests.current.delete(requestId);
    if (!r.ok) {
      if (r.status === 401) setSession(null);
      throw Error(j.message || "Request failed.");
    }
    return j;
  }, [session?.csrf]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ from, to });
      if (partyFilter) q.set("partyId", partyFilter);
      if (accountFilter) q.set("account", accountFilter);
      const d = await api("overview?" + q);
      if (sequence === loadSequence.current) { setData(d); setError(""); }
    } catch (e: any) {
      if (sequence === loadSequence.current) setError(e.message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [api, session, from, to, partyFilter, accountFilter]);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/mode").then(r => r.json()).then(d => setDemoLogin(d.demoLogin)).catch(() => {}),
      fetch("/api/auth/me").then(async r => { if (r.ok) setSession(await r.json()); }).catch(() => {})
    ]).finally(() => setAuthReady(true));
  }, []);

  useEffect(() => { refresh() }, [refresh]);

  useEffect(() => {
    if (modal || preview) {
      const old = document.activeElement as HTMLElement;
      setTimeout(() => modalRef.current?.querySelector<HTMLElement>("input,select,button")?.focus(), 0);
      const fn = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !busy) { setModal(null); setPreview(null); }
        if (e.key === "Tab") {
          const els = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href]') || []).filter(el => el.offsetParent !== null);
          if (!els.length) return;
          if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1)?.focus(); }
          else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0].focus(); }
        }
      };
      document.addEventListener("keydown", fn);
      return () => { document.removeEventListener("keydown", fn); old?.focus(); };
    }
  }, [modal, preview, busy]);

  // A dialog's error belongs to that dialog; once it closes, don't leave it on the page.
  const modalWasOpen = useRef(false);
  useEffect(() => {
    if (modal) modalWasOpen.current = true;
    else if (modalWasOpen.current) {
      modalWasOpen.current = false;
      setError("");
    }
  }, [modal]);

  function go(p: string) {
    setPage(p);
    sessionStorage.setItem("company-accounts-active-page", p);
    setSearch("");
    setMobile(false);
    setAccountFilter("");
  }

  function open(type: string, extra: Row = {}) {
    setError("");
    setFormKind(type === "capital" ? "CAPITAL_IN" : "EXPENSE");
    setPaymentDoc(extra.document?.id || "");
    setDocLines([{ description: "", quantity: "1", price: "", taxRate: "18", hsn: "" }]);
    const selectedTaxTreatment = extra.document?.tax_treatment || "TAXABLE";
    setTaxTreatment(selectedTaxTreatment);
    setNewDocKind(extra.document?.kind || "INVOICE");
    setPlaceOfSupply(extra.document?.place_of_supply || "");
    setManualSupplyMode(extra.document && (!isStateCode(data?.company?.state_code) || !isStateCode(extra.document.place_of_supply)) ? (extra.document.interstate ? "INTER" : "INTRA") : "");
    setDocNumber(type === "document" ? extra.document?.number || "" : "");
    setDocCurrency(extra.document?.currency || "INR");
    setAdvanceAmount(String(extra.document?.advance_amount ?? "0"));
    setAdvanceStatus(extra.document?.advance_status || "NOT_RECEIVED");
    setDocumentCompany({ ...companyDocumentProfile(data?.company || {}, selectedTaxTreatment), ...(extra.document?.company_snapshot || {}) });
    setDocPartyId(extra.document?.party_id || "");
    (() => {
      const selected = extra.document?.party || data?.parties.find((p: Row) => p.id === extra.document?.party_id);
      setClientInfo({
        name: selected?.name || extra.document?.client_snapshot?.name || "",
        address: selected?.address || extra.document?.client_snapshot?.address || "",
        gstin: selected?.gstin || extra.document?.client_snapshot?.gstin || "",
        contactName: selected?.contact_name || extra.document?.client_snapshot?.contact_name || "",
        phone: selected?.phone || extra.document?.client_snapshot?.phone || ""
      })
    })();
    if (extra.document?.lines)
      setDocLines(extra.document.lines.map((l: Row) => ({ ...l, price: String(l.price), quantity: String(l.quantity), taxRate: String(l.taxRate), hsn: l.hsn || "" })));
    setModal({ type, ...extra });
  }

  type Notice = string | ToastInput | null;
  /**
   * Runs a write and reports it. `notice` is the success toast (a title, a full toast, or a function of the
   * API result so it can name the saved number); null shows nothing. Failures inside an open dialog stay inline
   * in that dialog; failures from page actions (Issue, Convert, Confirm…) become an error toast titled `errorTitle`.
   */
  async function perform(path: string, body?: unknown, method = "POST", notice: Notice | ((r: any) => Notice) = "Changes saved", errorTitle = "Something went wrong", quietError = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, method, body);
      await refresh();
      const n = typeof notice === "function" ? notice(r) : notice;
      if (n) notify(typeof n === "string" ? { tone: "success", title: n } : n);
      return r;
    } catch (e: any) {
      if (modal) setError(e.message);
      else if (!quietError) notify({ tone: "error", title: errorTitle, description: e.message });
      throw e;
    } finally {
      setBusy(false)
    }
  }

  const fail = (title: string) => (e: any) => notify({ tone: "error", title, description: e?.message || "Please try again." });

  function exportRows(rows: Row[], name: string) {
    if (!rows.length) return notify({ tone: "info", title: "Nothing to export", description: "No entries match the current filters." });
    exportCSV(rows, name);
    notify({ title: "Export ready", description: rows.length + (rows.length === 1 ? " entry" : " entries") + " downloaded as CSV." });
  }

  async function addVoucherCategory(kind: string, name: string) {
    const isPartyCategory = ["INCOME", "CAPITAL_IN", "CAPITAL_RETURN", "REIMBURSEMENT", "LOAN_IN", "LOAN_REPAY"].includes(kind);
    const added: ToastInput = { title: "Category added", description: "“" + name + "” is now available in this list." };
    const result = isPartyCategory
      ? await perform("parties", { name, kind: "BOTH", voucherCategoryKind: kind }, "POST", added)
      : await perform("accounts", { name, kind: ["ASSET", "INVESTMENT"].includes(kind) ? "ASSET" : "EXPENSE", voucherCategoryKind: kind }, "POST", added);
    return result;
  }

  async function viewDoc(id: string) {
    try { setPreview({ ...(await api("documents/" + id)), view: "document" }); }
    catch (e: any) { fail("Couldn't open the preview")(e) }
  }

  async function viewReceipt(id: string) {
    try { setPreview({ ...(await api("receipts/" + id)), view: "receipt" }); }
    catch (e: any) { fail("Couldn't open the receipt")(e) }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      switch (modal?.type) {
        case "party": await perform("parties", f, "POST", { title: "Contact added", description: f.name + " is ready to use on documents and vouchers." }); break;
        case "project": await perform("projects", { ...f, partyId: f.partyId || null }, "POST", {
          title: "Project created",
          description: f.name + (Number(f.budget) > 0 ? " · budget " + money(f.budget) : "") + ". Link vouchers to it to track profit."
        }); break;
        case "voucher": case "capital": await perform("vouchers", { ...f, kind: formKind, partyId: f.partyId || null, projectId: f.projectId || null }, "POST", (r: Row) => ({
          title: voucherLabel(formKind) + " recorded",
          description: [r?.number, money(f.amount), f.description].filter(Boolean).join(" · ")
        })); break;
        case "document": {
          if (taxTreatment === "TAXABLE" && draftInterstate === null) throw Error("Select CGST + SGST or IGST because supplier state information is unavailable.");
          const payload = {
            ...f,
            kind: newDocKind,
            number: docNumber || undefined,
            taxTreatment,
            ...(draftInterstate === null ? {} : { interstate: draftInterstate }),
            projectId: f.projectId || null,
            currency: docCurrency,
            advanceAmount,
            advanceStatus: Number(advanceAmount) <= 0 ? "NOT_RECEIVED" : Number(advanceAmount) >= draftInvoiceTotals.total ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED",
            client: clientInfo,
            company: taxTreatment === "OUTSIDE_GST" ? documentCompany : undefined,
            lines: docLines
          };
          const path = modal.document ? "documents/" + modal.document.id : "documents";
          const label = documentLabel(newDocKind), who = clientInfo.name || "the client";
          // Invoices and payment receipts are numbered on issue, so a new draft has no number worth showing yet.
          const numberedOnIssue = ["INVOICE", "BILL"].includes(newDocKind);
          await perform(path, payload, modal.document ? "PATCH" : "POST", (r: Row) => modal.document
            ? { title: label + " updated", description: "Changes to " + (numberedOnIssue ? "the draft for " + who : (r?.number || modal.document.number) + " · " + who) + " are saved." }
            : { title: label + " draft saved", description: numberedOnIssue ? who + " · a number is assigned when you issue it." : [r?.number, who].filter(Boolean).join(" · ") });
          break;
        }
        case "payment": {
          const doc = data?.documents.find((d: Row) => d.id === paymentDoc);
          await perform("payments", {
            ...f,
            direction: "RECEIPT",
            partyId: doc?.party_id || f.partyId,
            client: clientInfo,
            allocations: doc ? [{ documentId: doc.id, amount: f.amount }] : []
          }, "POST", {
            title: "Receipt recorded",
            description: money(f.amount) + " from " + (clientInfo.name || "the client") + (doc ? " against " + doc.number : " as an advance") + "."
          });
          break;
        }
        case "creditNote": {
          const lines = (modal.document.lines as Row[])
            .map((_, i) => ({ line: i, quantity: String(f["qty-" + i] || "0").trim() }))
            .filter(l => Number(l.quantity) > 0);
          if (!lines.length) throw Error("Enter a quantity to credit on at least one line.");
          await perform("documents/" + modal.document.id + "/credit-note", { date: f.date, reason: f.reason, lines }, "POST", (r: Row) => ({
            title: "Credit note issued",
            description: [r?.number, "against " + modal.document.number].filter(Boolean).join(" · ") + ". The invoice balance is reduced."
          }));
          break;
        }
        case "cancel": {
          const d = modal.document, postedReceipt = d.kind === "BILL" && d.status === "ISSUED";
          await perform("documents/" + d.id + "/cancel", { date: f.date || today(), reason: f.reason }, "POST", {
            title: documentLabel(d.kind) + " cancelled",
            description: postedReceipt
              ? d.number + " was reversed in cash/bank and income. The original stays in the audit trail."
              : d.number + " is kept for the record. Nothing was posted to the ledger."
          });
          break;
        }
        case "budget": {
          const category = accounts.find((a: Row) => a.code === f.account)?.name || "Category";
          const month = new Date(f.month + "-01T12:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });
          await perform("budgets", f, "POST", { title: "Budget saved", description: category + " · " + month + " · " + money(f.amount) });
          break;
        }
        case "recurring": await perform("recurring", { ...f, day: Number(f.day) }, "POST", {
          title: "Recurring entry scheduled",
          description: f.name + " · " + money(f.amount) + " on day " + f.day + " of each month. Confirm it once paid."
        }); break;
        case "import": {
          const lines = parseCSV(f.csv);
          if (!lines.length) throw Error("Add at least one statement row.");
          await perform("bank/import", { account: f.account, lines }, "POST", (r: Row) => r.added > 0
            ? { title: "Statement imported", description: r.added + " new line" + (r.added === 1 ? "" : "s") + " ready to match" + (r.skipped ? "; " + r.skipped + " duplicate" + (r.skipped === 1 ? "" : "s") + " skipped." : ".") }
            : { tone: "info", title: "No new lines imported", description: "All " + r.skipped + " row" + (r.skipped === 1 ? " was" : "s were") + " already imported." });
          break;
        }
        case "match": {
          const entry = data?.entries.find((e: Row) => e.id === f.entryId);
          await perform("bank/" + modal.line.id + "/match", { entryId: f.entryId }, "POST", {
            title: "Bank line matched",
            description: modal.line.description + " · " + money(modal.line.amount) + (entry ? " ↔ " + entry.number : "")
          });
          break;
        }
        case "reverse": await perform("vouchers/" + modal.entry.id + "/reverse", f, "POST", (r: Row) => ({
          title: "Entry reversed",
          description: modal.entry.number + (r?.number ? " was reversed by " + r.number : " was reversed") + ". The original stays on record."
        })); break;
        case "close": await perform("period-close", { through: f.through || null, reason: f.reason }, "POST", f.through
          ? { title: "Period locked", description: "No new postings dated on or before " + day(f.through) + "." }
          : { title: "Periods reopened", description: "Entries can be posted on any date again." }); break;
        case "user": await perform("users", f, "POST", { title: "Team member added", description: f.name + " can now sign in as " + pretty(f.role) + "." }); setUsers(await api("users")); break;
        case "journal": {
          let lines;
          try { lines = JSON.parse(f.lines); }
          catch { throw Error("Journal lines must be valid JSON."); }
          await perform("journals", { date: f.date, description: f.description, lines }, "POST", (r: Row) => ({
            title: "Journal posted",
            description: [r?.number, f.description].filter(Boolean).join(" · ")
          }));
          break;
        }
      }
      setModal(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const canWrite = session?.user.role !== "VIEWER";
  // Search what people can see: plain field values and document line text. Ids, audit columns and
  // nested snapshots (which hold logos as base64) would otherwise produce false matches.
  const hiddenSearchKeys = ["id", "created_by", "created_at", "posting_tx", "reversal_of", "reversed_by"];
  const searchText = (r: Row) => [
    ...Object.entries(r)
      .filter(([k, v]) => v != null && typeof v !== "object" && !hiddenSearchKeys.includes(k) && !k.endsWith("_id"))
      .map(([, v]) => String(v)),
    ...(Array.isArray(r.lines) ? r.lines.flatMap((l: Row) => [l.description, l.hsn]) : [])
  ].filter(Boolean).join(" ").toLowerCase();
  const filter = (rows: Row[]) => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => searchText(r).includes(q)) : rows;
  };
  const accounts = data?.accounts || [],
    cashAccounts = accounts.filter((a: Row) => a.is_cash);

  const bankSelect = (name = "cashAccount", dailyVoucher = false) =>
    <select name={name} required>
      {cashAccounts.filter((a: Row) => !dailyVoucher || ["1000", "1010"].includes(a.code)).map((a: Row) => <option key={a.code} value={a.code}>{dailyVoucher ? a.code === "1010" ? "Petty Cash" : "Bank Transfer" : a.name}</option>)}
    </select>;

  const partySelect = (name = "partyId", required = false) =>
    <select name={name} required={required}>
      <option value="">Select a party{required ? "" : " (optional)"}</option>
      {data?.parties.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>;

  const catSelect = (name = "account", kind = "EXPENSE") =>
    <select name={name} required>
      {accounts.filter((a: Row) => a.kind === kind).map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}
    </select>;

  const voucherCategoryItems = (kind: string) => {
    const customAccounts = accounts.filter((a: Row) => a.voucher_category_kind === kind).map((a: Row) => ({ value: a.code, label: a.name }));
    const standardAccounts: Record<string, Row[]> = {
      EXPENSE: [
        ["5600", "Marketing and advertising"], ["5610", "Subscriptions"], ["5620", "Wages"],
        ["5630", "Watercan"], ["5640", "Stationary"], ["5650", "Travelling expense"], ["5660", "Salaries"]
      ].map(([value, label]) => ({ value, label })),
      ASSET: [
        ["1510", "Furniture & fixtures"], ["1520", "Computers and laptops"], ["1530", "Office equipment"]
      ].map(([value, label]) => ({ value, label })),
      INVESTMENT: [["1410", "FD"], ["1420", "RD"]].map(([value, label]) => ({ value, label }))
    };
    if (kind === "EXPENSE") return [
      ...standardAccounts.EXPENSE,
      ...customAccounts
    ];
    if (kind === "ASSET") return [
      ...standardAccounts.ASSET,
      ...customAccounts
    ];
    if (kind === "INVESTMENT") return [
      ...standardAccounts.INVESTMENT,
      ...customAccounts
    ];
    const parties: Row[] = data?.parties || [];
    // Owner and reimbursement categories are the contacts tagged for them (voucher_category_kind, comma separated).
    const tagged = (p: Row) => String(p.voucher_category_kind || "").split(",").includes(kind);
    const allowed = ["INCOME", "LOAN_IN", "LOAN_REPAY"].includes(kind) ? parties : parties.filter(tagged);
    return allowed.map((p: Row) => ({ value: p.id, label: p.name }));
  };

  function documentStatus(d: Row) {
    if (d.status === "DRAFT") return "Draft";
    if (d.status === "CANCELLED") return "Cancelled";
    if (["QUOTATION", "PROFORMA", "CREDIT_NOTE"].includes(d.kind)) return "Issued";
    if (d.kind === "BILL") return "Received";
    if (Number(d.credited) > 0 && Number(d.credited) >= Number(d.total)) return "Credited";
    if (Number(d.paid) >= Number(d.total)) return "Paid";
    if (d.due_date < to) return "Overdue";
    return Number(d.paid) > 0 ? "Part paid" : "Unpaid";
  }

  const submitLogin = async (form: Record<string, FormDataEntryValue>) => {
    setBusy(true);
    try { setSession(await api("auth/login", "POST", form)); setError(""); }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  };

  const openDemo = async () => {
    setBusy(true);
    try { setSession(await api("auth/demo", "POST", {})); setError(""); }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  };

  if (!authReady) return <div className="loading-page"><div className="logo-mark">l<span>.</span></div><p>Opening your workspace…</p></div>;
  if (!session) return <LoginScreen error={error} busy={busy} demoLogin={demoLogin} onLogin={submitLogin} onDemo={openDemo} />;
  if (!data) return <div className="loading-page"><div className="logo-mark">l<span>.</span></div><p>{error || "Preparing your accounts…"}</p>{error && <ActionButton className="btn" loading={loading} loadingText="Retrying…" onClick={refresh}>Retry</ActionButton>}</div>;

  const metric = data.metrics,
    active = navigation.find(n => n[0] === page),
    outstanding = data.documents.filter((d: Row) => d.kind === "INVOICE" && d.status === "ISSUED" && Number(d.total) > Number(d.paid));
  const supplyStateKnown = isStateCode(data.company.state_code) && isStateCode(placeOfSupply),
    draftInterstate = supplyStateKnown ? placeOfSupply !== data.company.state_code : manualSupplyMode === "INTER" ? true : manualSupplyMode === "INTRA" ? false : null,
    draftInvoiceTotals = invoiceTotals(docLines, taxTreatment === "TAXABLE", draftInterstate),
    draftPaymentTotal = docLines.reduce((sum, l) => sum + Math.round(Number(l.price || 0) * 100) / 100, 0),
    advanceValue = Math.min(draftInvoiceTotals.total, Math.max(0, Number(advanceAmount) || 0));
  const filteredDocs = filter(data.documents).filter((d: Row) =>
    (docKind === "ALL" || d.kind === docKind) &&
    (taxTab === "ALL" || (taxTab === "GST" ? d.tax_treatment === "TAXABLE" : d.tax_treatment !== "TAXABLE")) &&
    d.issue_date >= from
  );
  const txs = filter(data.entries).filter((e: Row) =>
    page === "capital" ? ["CAPITAL_IN", "CAPITAL_RETURN", "LOAN_IN", "LOAN_REPAY", "INVESTMENT"].includes(e.kind)
    : page === "income" ? ["INCOME", "EXPENSE", "REIMBURSEMENT", "INVOICE", "BILL", "CREDIT_NOTE"].includes(e.kind)
    : true
  );

  const entryModalContext = {
    modal, setModal, modalRef, busy, error, submit, Field, bankSelect, partySelect, catSelect,
    voucherCategoryItems, addVoucherCategory,
    formKind, setFormKind, today, pretty, data, newDocKind, setNewDocKind, taxTreatment, setTaxTreatment,
    docLines, setDocLines, placeOfSupply, setPlaceOfSupply, manualSupplyMode, setManualSupplyMode,
    supplyStateKnown, draftInterstate, draftInvoiceTotals, draftPaymentTotal, amountInWords, money,
    paymentDoc, setPaymentDoc, accounts, from,
    docNumber, setDocNumber, docCurrency, setDocCurrency, advanceAmount, setAdvanceAmount, advanceValue,
    advanceStatus, setAdvanceStatus, clientInfo, setClientInfo, documentCompany, setDocumentCompany, docPartyId, setDocPartyId,
    companyDocumentProfile
  };

  const pageContext = {
    page, data, metric, money, short, day, pretty, palette, accounts, go, setAccountFilter,
    documentStatus, outstanding, canWrite, viewReceipt, viewDoc, open, Empty, taxTab, setTaxTab,
    docKind, setDocKind, search, setSearch, filteredDocs, perform, from, to, partyFilter, accountFilter,
    loading, busy, setError, notify, fail, report, setReport, Field, users, setUsers, api, session, setModal, EntryTable, Report,
    Badge, today, exportCSV, exportRows, txs, filter, active, partySelect, bankSelect, catSelect
  };

  return <div className="app-shell">
    <Sidebar
      company={data.company}
      user={session.user}
      page={page}
      mobile={mobile}
      outstandingCount={outstanding.length}
      onNavigate={go}
      onLogout={() => perform("auth/logout", {}, "POST", null, "Couldn't sign out").then(() => setSession(null)).catch(() => {})}
    />
    {mobile && <SidebarCover onClose={() => setMobile(false)} />}
    <div className="main-shell">
      <Header
        pageTitle={active?.[1]}
        userName={session.user.name}
        demo={Boolean(data.company.demo)}
        hasOutstanding={outstanding.length > 0}
        onOpenMenu={() => setMobile(true)}
        onOutstanding={() => { go("documents"); setDocKind("INVOICE") }}
      />
      <main>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{page === "dashboard" ? "YOUR FINANCES, AT A GLANCE" : "COMPANY ACCOUNTS"}</span>
            <h1>{page === "dashboard" ? "Business overview" : active?.[1]}</h1>
            <p>{({
              dashboard: "A little clarity for every business decision.",
              documents: "From the first proposal to the final payment.",
              vouchers: "Your day-to-day entries, all in one place.",
              income: "Understand what you earn and where it goes.",
              capital: "Keep funding and investments separate from operating profit.",
              parties: "Every relationship. Every outstanding balance.",
              projects: "See the revenue and direct costs behind each project.",
              bank: "Know your balances. Match your bank movements.",
              reports: "Follow every total back to your ledger.",
              recurring: "Review a scheduled entry, then confirm the actual payment.",
              budgets: "Plan your spend and follow the actuals.",
              settings: "The details that keep your accounts running."
            } as Row)[page]}</p>
          </div>
          <div className="heading-actions">
            <button className="btn" onClick={() => exportRows(txs.map((e: Row) => ({ Date: e.entry_date, Number: e.number, Type: e.kind, Description: e.description, Amount: e.amount })), "account-entries-" + from + "-" + to)}>
              <Download size={16} />Export visible entries
            </button>
            {canWrite && <button className="btn primary" onClick={() => open(page === "documents" ? "document" : page === "parties" ? "party" : page === "projects" ? "project" : page === "capital" ? "capital" : page === "budgets" ? "budget" : page === "recurring" ? "recurring" : "voucher")}>
              <Plus size={17} />{page === "documents" ? "New document" : page === "parties" ? "Add contact" : page === "projects" ? "New project" : page === "budgets" ? "Set budget" : page === "recurring" ? "New schedule" : "New voucher"}
            </button>}
          </div>
        </div>
        {error && !modal && <div className="error" role="alert">
          <AlertCircle size={17} />{error}
          <button className="icon-btn" onClick={() => setError("")}><X size={15} /></button>
        </div>}
        <div className="filterbar">
          <div className="range-inputs">
            <Clock3 size={15} />
            <input aria-label="Start date" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <span>—</span>
            <input aria-label="End date" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="filter-chip" onClick={() => { setFrom(monthStart()); setTo(today()) }}>This month</button>
          <button className="filter-chip" onClick={() => { setFrom(monthStart(-5)); setTo(today()) }}>6 months</button>
          <select aria-label="Filter by client or vendor" value={partyFilter} onChange={e => setPartyFilter(e.target.value)}>
            <option value="">All clients & vendors</option>
            {data.parties.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className={"icon-btn refresh " + (loading ? "spinning" : "")} aria-label="Refresh data" disabled={loading} onClick={refresh}><RefreshCw size={15} /></button>
        </div>
        {page === "dashboard" && <DashboardPage ctx={pageContext} />}
        <DocumentsPage ctx={pageContext} />
        <LedgerActivityPages ctx={pageContext} />
        <PartiesPage ctx={pageContext} />
        <ProjectsPage ctx={pageContext} />
        <BankPage ctx={pageContext} />
        <ReportsPage ctx={pageContext} />
        <BudgetsPage ctx={pageContext} />
        <RecurringPage ctx={pageContext} />
        <SettingsPage ctx={pageContext} />
        <footer className="page-footer">
          <span><span className="tiny-dot" /> All figures come from the posted ledger</span>
          <span>LedgerDesk · Development v0.1</span>
        </footer>
      </main>
    </div>
    <ToastViewport toasts={toasts} onDismiss={dismiss} />
    <WorkspaceEntryModal context={entryModalContext} />
    {preview && <div className="modal-backdrop print-backdrop">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Document preview" className="modal print-modal">
        <div className="print-controls">
          <span>Document preview</span>
          <ActionButton className="btn" loadingText="Preparing PDF…" onClick={async () => { await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".document-page img")).map(img => img.decode().catch(() => {}))); window.print(); }}><Printer size={16} />Print / Save PDF</ActionButton>
          <button className="icon-btn" aria-label="Close preview" onClick={() => setPreview(null)}><X size={20} /></button>
        </div>
        <DocumentPreview d={preview} />
      </div>
    </div>}
  </div>;
}
