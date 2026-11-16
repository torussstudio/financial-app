import { Bell, ChevronRight, Menu, Search, Moon, Sun } from "lucide-react";
export function Header({ pageTitle, userName, demo, hasOutstanding, onOpenMenu, onOutstanding, onSearch, dark, onToggleTheme }: {
  dark?: boolean;
  onToggleTheme?: () => void;
  onSearch?: () => void;
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
    <button className="search-trigger" aria-label="Search (Ctrl+K)" onClick={onSearch}><Search size={15}/><span>Search</span><kbd>Ctrl K</kbd></button>
    <button className="icon-btn" title={dark ? "Light mode" : "Dark mode"} aria-label="Toggle dark mode" onClick={onToggleTheme}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
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
