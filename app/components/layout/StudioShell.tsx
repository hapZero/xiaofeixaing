"use client";

import type { ReactNode } from "react";
import { Logo } from "../ui";
import { useStudioAuth } from "../../features/auth/AuthContext";
import { useSettings } from "../../features/settings/SettingsProvider";
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
      <div className="history-heading"><span>创作历史</span></div>
      <div className="history-list history-truthful-empty"><p>账号项目请在“短剧 Agent”中查看</p></div>
      <div className="sidebar-bottom"><span className="sidebar-product-note">单人创作工作台</span></div>
    </aside>
  );
}

function Topbar() {
  const { user, signOut } = useStudioAuth();
  const { openSettings } = useSettings();
  const avatar = user.displayName.trim().slice(0, 1).toUpperCase() || "飞";
  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <button className="top-link" type="button" onClick={() => openSettings("readiness")}><span className="online-dot" />设置</button>
      <div className="profile-button profile-summary" title={user.email}><span className="profile-avatar">{avatar}</span><span>{user.displayName}</span></div>
      <button className="top-link sign-out-link" onClick={signOut}>退出登录</button>
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
