export type Row = Record<string, any>;
// Calendar dates in the user's own time zone; toISOString() would give the UTC date (yesterday before 05:30 in India).
const isoDate = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
export const localDate = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return isoDate(d); };
export const localMonthStart = (offsetMonths = 0) => { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1)); };
// Subtracts in whole paise so outstanding amounts never pick up floating-point noise such as 180.60000000000002.
export const moneySub = (a: any, b: any) => ((Math.round(Number(a || 0) * 100) - Math.round(Number(b || 0) * 100)) / 100).toFixed(2);
export const money = (value: any) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
export const short = (v: number) => Math.abs(v) >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L" : Math.abs(v) >= 1000 ? "₹" + (v / 1000).toFixed(0) + "k" : "₹" + v;
export const pretty = (s: string) => s === "ASSET" ? "Assets" : s === "REIMBURSEMENT" ? "Reimbursements" : s ? s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
// Names used in notifications, e.g. "Quotation draft saved", "Payment receipt cancelled".
export const documentLabel = (kind: string) => ({
  INVOICE: "Invoice", QUOTATION: "Quotation", PROFORMA: "Proforma", BILL: "Payment receipt", CREDIT_NOTE: "Credit note"
} as Record<string, string>)[kind] || "Document";
export const voucherLabel = (kind: string) => ({
  EXPENSE: "Expense", INCOME: "Income", CAPITAL_IN: "Capital in", CAPITAL_RETURN: "Capital return", INVESTMENT: "Investment",
  ASSET: "Asset purchase", REIMBURSEMENT: "Reimbursement", LOAN_IN: "Loan received", LOAN_REPAY: "Loan repayment"
} as Record<string, string>)[kind] || "Entry";
export const day = (s: string) => new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString(
  "en-IN",
  { day: "2-digit", month: "short", year: "numeric" }
);
function numberWords(input: number): string { const ones = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen"
  ], tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]; const under100 = (n: number) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""); const under1000 = (n: number) => n < 100 ? under100(n) : ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + under100(n % 100) : ""); if (input === 0)
  return "Zero"; const parts: string[] = []; for (const [unit, size] of [["Crore", 10000000], ["Lakh", 100000], ["Thousand", 1000], ["", 1]] as [
  string,
  number
][]) {
  const count = Math.floor(input / size);
  if (count) {
    parts.push((unit === "Crore" && count >= 1000 ? numberWords(count) : under1000(count)) + (unit ? " " + unit : ""));
    input %= size;
  }
} return parts.join(" "); }
export const amountInWords = (value: unknown): string => { const n = Number(value); if (!Number.isFinite(n) || n < 0)
  return "Zero Rupees Only"; const paise = Math.round((n - Math.floor(n)) * 100),
    rupees = Math.floor(n + (paise === 100 ? 1 : 0)); const cents = paise === 100 ? 0 : paise; return `Rupees ${numberWords(rupees)}${cents ? ` and ${numberWords(cents)} Paise` : ""} Only`; };
