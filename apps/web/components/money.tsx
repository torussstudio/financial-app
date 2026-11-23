// Rupees with the paise set lighter, so the eye reads the whole amount first. Negative amounts get a real minus sign.
export function Money({ value, className = "" }: { value: any; className?: string }) {
  const v = Number(value || 0);
  const [whole, paise] = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v)).split(".");
  return <span className={"ov-m" + (v < 0 ? " neg" : "") + (className ? " " + className : "")}><span className="cur">{v < 0 ? "−₹" : "₹"}</span>{whole}<span className="ps">.{paise}</span></span>;
}
