import { Bell, ChevronRight, Menu } from "lucide-react";
export function Header({ pageTitle, userName, demo, hasOutstanding, onOpenMenu, onOutstanding }: {
  pageTitle?: string;
  userName: string;
  demo: boolean;
  hasOutstanding: boolean;
  onOpenMenu: () => void;
  onOutstanding: () => void;
}) {
  return <header className="topbar">
    <div className="breadcrumb">
    <button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={onOpenMenu}>
        <Menu size={20}/>
      </button>
    <span>Workspace</span>
      <ChevronRight size={14}/>
      <strong>{pageTitle}</strong>
  </div>
    <div className="topbar-right">
    {demo && <span className="demo-pill"><i /> DEMO WORKSPACE</span>}
    <button className="icon-btn"
    title="Outstanding invoices"
    aria-label="Show outstanding invoices"
    onClick={onOutstanding}>
        <Bell size={18}/>
        {hasOutstanding && <i className="notification-dot"/>}
      </button>
    <span className="avatar small-avatar">{userName[0]}</span>
  </div>
  </header>;
}
