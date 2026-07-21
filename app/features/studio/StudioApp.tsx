"use client";

import { useState } from "react";
import { Login } from "../auth/Login";
import { AssetsPage } from "../assets/AssetsPage";
import { GlobalAssets } from "../assets/GlobalAssets";
import { FreeCanvasPage } from "../canvas/CanvasWorkspace";
import { DramaHub } from "../drama/DramaHub";
import { EditorPage } from "../editor/EditorPage";
import { Home } from "../home/Home";
import { ScriptPage } from "../script/ScriptPage";
import { VideosPage } from "../videos/VideosPage";
import { WorkflowCenter } from "../workflows/WorkflowCenter";
import type { ProjectSummary, StudioUser, View } from "./types";

export function StudioApp() {
  const [view, setView] = useState<View>("login");
  const [, setUser] = useState<StudioUser | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);

  const enter = (authenticatedUser: StudioUser) => {
    setUser(authenticatedUser);
    setView("home");
  };
  const openProject = (project: ProjectSummary, target: View) => {
    setActiveProject(project);
    setView(target);
  };

  if (view === "login") return <Login onEnter={enter} />;
  if (view === "home") return <Home onNavigate={setView} />;
  if (view === "drama") return <DramaHub onNavigate={setView} onOpenProject={openProject} />;
  if (view === "script") return <ScriptPage onNavigate={setView} projectId={activeProject?.id ?? null} />;
  if (view === "assets") return <AssetsPage onNavigate={setView} project={activeProject} />;
  if (view === "videos") return <VideosPage onNavigate={setView} project={activeProject} />;
  if (view === "editor") return <EditorPage onNavigate={setView} project={activeProject} />;
  if (view === "canvas") return <FreeCanvasPage onNavigate={setView} project={activeProject?.sourceType === "canvas" ? activeProject : null} />;
  if (view === "workflows") return <WorkflowCenter onNavigate={setView} />;
  return <GlobalAssets onNavigate={setView} />;
}
