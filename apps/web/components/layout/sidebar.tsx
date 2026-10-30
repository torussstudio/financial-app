import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  FileText,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Repeat2,
  Settings,
  ShieldCheck,
  Target,
  Users,
  Wallet,
  BookOpen
} from "lucide-react";
import { ActionButton } from "../action-button";
export const navigation = [
  ["dashboard", "Overview", LayoutDashboard], ["documents", "Documents", FileText],
  ["vouchers", "Daily vouchers", ArrowLeftRight], ["income", "Income & expenses", Wallet],
  ["capital", "Capital & investments", Landmark], ["parties", "Clients & vendors", Users],
  ["projects", "Projects", FolderKanban], ["bank", "Bank & cash", BookOpen],
  ["reports", "Reports", ChartNoAxesCombined], ["recurring", "Recurring entries", Repeat2],
  ["budgets", "Budgets", Target], ["settings", "Settings", Settings],
] as const;
type Props = {
  company: {
    name: string
  };
  user: {
    name: string;
    role: string
  };
  page: string;
  mobile: boolean;
  outstandingCount: number;
  onNavigate: (page: string) => void;
  onLogout: () => void | Promise<unknown>;
};
const pretty = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export function Sidebar({ company, user, page, mobile, outstandingCount, onNavigate, onLogout }: Props) {
  return <aside className={`sidebar ${mobile ? "open" : ""}`}>
    <div className="brand"><div className="logo-mark">l<span>.</span></div>ledgerdesk</div>
    <div className="company-switch">
      <span className="company-avatar">{company.name.slice(0, 1)}</span>
      <div><strong>{company.name}</strong><small>Company workspace</small></div>
      <LockKeyhole size={13}/>
    </div>
    <span className="nav-label">WORKSPACE</span>
    <nav>
      {navigation.map(([key, label, Icon], index) => <div key={key}>
      {index === 8 && <span className="nav-label second">INSIGHTS &amp; CONTROLS</span>}
      <button onClick={() => onNavigate(key)} className={page === key ? "active" : ""}>
        <Icon size={18}/>
          <span>{label}</span>
          {key === "documents" && <b>{outstandingCount}</b>}
      </button>
    </div>)}
    </nav>
    <div className="sidebar-foot">
      <div className="safe">
        <ShieldCheck size={18}/>
        <div>One connected ledger<small>Every entry, accounted for.</small></div>
      </div>
      <ActionButton className="profile" onClick={onLogout} loadingText="Signing out…">
        <span className="avatar">{user.name[0]}</span>
        <div><strong>{user.name}</strong><small>{pretty(user.role)}</small></div>
        <LogOut size={16}/>
      </ActionButton>
    </div>
  </aside>;
}
export function SidebarCover({ onClose }: {
  onClose: () => void
}) {
  return <div className="sidebar-cover" onClick={onClose}/>;
}
