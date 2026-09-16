"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StudioAuthProvider } from "../auth/AuthContext";
import { Login } from "../auth/Login";
import { AssetsPage } from "../assets/AssetsPage";
import { GlobalAssets } from "../assets/GlobalAssets";
import { FreeCanvasPage } from "../canvas/CanvasWorkspace";
import { DramaHub, type CreationMode } from "../drama/DramaHub";
import { EditorPage } from "../editor/EditorPage";
import { Home } from "../home/Home";
import { ScriptPage } from "../script/ScriptPage";
import { SettingsProvider } from "../settings/SettingsProvider";
import { VideosPage } from "../videos/VideosPage";
import type { ProjectSummary, StudioUser, View } from "./types";

export function StudioApp() {
  const [view, setView] = useState<View>("login");
  const [user, setUser] = useState<StudioUser | null>(null);
  const [restoringAccount, setRestoringAccount] = useState(true);
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("上传剧本");

  const enter = (authenticatedUser: StudioUser) => {
    window.sessionStorage.setItem("xiaofeixiang_entered", "1");
    setUser(authenticatedUser);
    setView("home");
  };
  useEffect(() => {
    if (window.sessionStorage.getItem("xiaofeixiang_entered") !== "1") {
      queueMicrotask(() => setRestoringAccount(false));
      return undefined;
    }
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("ACCOUNT_SESSION_EXPIRED");
        return response.json() as Promise<{ user?: StudioUser }>;
      })
      .then((data) => {
        if (cancelled || !data.user) return;
        setUser(data.user);
        setView("home");
      })
      .catch(() => { if (!cancelled) window.sessionStorage.removeItem("xiaofeixiang_entered"); })
      .finally(() => { if (!cancelled) setRestoringAccount(false); });
    return () => { cancelled = true; };
  }, []);
  const signOut = () => {
    window.sessionStorage.removeItem("xiaofeixiang_entered");
    setUser(null);
    setActiveProject(null);
    setActiveEpisodeId(null);
    setView("login");
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) window.location.assign("/signout-with-chatgpt?return_to=/");
  };
  const openProject = (project: ProjectSummary, target: View) => {
    setActiveProject(project);
    setActiveEpisodeId(null);
    setView(target);
  };
  const openEpisodeEditor = (episodeId: string) => {
    setActiveEpisodeId(episodeId);
    setView("editor");
  };
  const startCreation = (mode: CreationMode) => {
    setCreationMode(mode);
    setView("drama");
  };

  if (restoringAccount) return <main className="account-restoring"><span className="logo-mark">飞</span><b>正在验证账号并恢复创作空间…</b></main>;
  if (view === "login" || !user) return <Login onEnter={enter} />;
  let content: ReactNode;
  if (view === "home") content = <Home onNavigate={setView} onOpenProject={openProject} onStartCreation={startCreation} />;
  else if (view === "drama") content = <DramaHub onNavigate={setView} onOpenProject={openProject} initialMode={creationMode} />;
  else if (view === "script") content = <ScriptPage onNavigate={setView} projectId={activeProject?.id ?? null} />;
  else if (view === "assets") content = <AssetsPage onNavigate={setView} project={activeProject} />;
  else if (view === "videos") content = <VideosPage onNavigate={setView} onOpenEditor={openEpisodeEditor} project={activeProject} />;
  else if (view === "editor") content = <EditorPage onNavigate={setView} project={activeProject} initialEpisodeId={activeEpisodeId} />;
  else if (view === "canvas") content = <FreeCanvasPage onNavigate={setView} project={activeProject?.sourceType === "canvas" ? activeProject : null} />;
  else content = <GlobalAssets onNavigate={setView} onOpenProject={openProject} />;
  return (
    <StudioAuthProvider user={user} signOut={signOut}>
      <SettingsProvider>{content}</SettingsProvider>
    </StudioAuthProvider>
  );
}
