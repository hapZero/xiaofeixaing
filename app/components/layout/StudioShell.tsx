import type { ReactNode } from "react";
import { Logo } from "../ui";
import type { View } from "../../features/studio/types";

function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <nav className="main-nav" aria-label="主导航">
        <button className={view === "home" ? "active" : ""} onClick={() => onNavigate("home")}><span>✦</span>创作</button>
        <button className={["drama", "script", "assets", "videos", "editor"].includes(view) ? "active" : ""} onClick={() => onNavigate("drama")}><span>▣</span>短剧 Agent</button>
        <button className={view === "globalAssets" ? "active" : ""} onClick={() => onNavigate("globalAssets")}><span>◇</span>资产</button>
      </nav>
      <div className="history-heading"><span>创作历史</span><button>查看全部</button></div>
      <div className="history-list">
        <button onClick={() => onNavigate("script")}><span className="history-dot blue" />旧教室的第三排</button>
        <button><span className="history-dot amber" />崇祯新变</button>
        <button><span className="history-dot violet" />十日终焉：天马试炼</button>
      </div>
      <div className="sidebar-bottom">
        <button><span>?</span>帮助与反馈</button>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <button className="top-link">CLI / API</button>
      <button className="top-link"><span className="online-dot" />连接工作引擎</button>
      <button className="icon-button" aria-label="通知">◌<span className="notification-dot" /></button>
      <button className="profile-button"><span className="profile-avatar">Z</span><span>创作者</span><b>⌄</b></button>
    </header>
  );
}

export function StudioShell({
  view,
  onNavigate,
  children,
}: {
  view: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={onNavigate} />
      <div className="app-main">
        <Topbar />
        {children}
      </div>
    </div>
  );
}

