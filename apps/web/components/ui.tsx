import type { ReactNode } from "react";
import { Layers } from "lucide-react";
type Tone = "" | "amber" | "blue" | "red" | "gray";
const badgeTones: Record<Tone, string> = {
  "": "bg-[#edf6ef] text-[#658b70]",
  amber: "bg-[#fbf5e8] text-[#b39b6d]",
  blue: "bg-[#ecf1f8] text-[#7c94b3]",
  red: "bg-[#fcf0e9] text-[#bc886e]",
  gray: "bg-[#f0f3ef] text-[#99a298]",
};
export function Field({ label, children, wide = false }: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return <label className={`flex min-w-0 flex-col gap-2 [&>span]:text-[11px] [&>span]:font-medium [&>span]:text-[#7e9277] [&_input]:min-h-[40px] [&_input]:w-full [&_input]:text-[12px] [&_select]:min-h-[40px] [&_select]:w-full [&_select]:text-[12px] [&_textarea]:!min-h-[40px] [&_textarea]:w-full [&_textarea]:text-[12px] ${wide ? "col-span-full max-[680px]:col-auto" : ""}`}>
    <span>{label}</span>
    {children}
  </label>;
}
export function Badge({ children, tone = "" }: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-[4px] px-[6px] py-1 text-[8px] font-medium ${badgeTones[tone]}`}>
    <i className="h-[3px] w-[3px] rounded-full bg-current"/>
    {children}
  </span>;
}
export function Empty({ label = "No records found", detail = "Try another date range or add your first entry." }: {
  label?: string;
  detail?: string;
}) {
  return <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-[35px] py-[35px] text-center text-[#a5b29e] [&>strong]:text-[13px] [&>strong]:font-medium [&>strong]:text-[#7e9176] [&>span]:max-w-[300px] [&>span]:text-[11px] [&>span]:leading-[1.7]">
    <Layers size={28}/>
    <strong>{label}</strong>
    <span>{detail}</span>
  </div>;
}
