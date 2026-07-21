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
import type { View } from "./types";

export function StudioApp() {
  const [view, setView] = useState<View>("login");
  if (view === "login") return <Login onEnter={() => setView("home")} />;
  if (view === "home") return <Home onNavigate={setView} />;
  if (view === "drama") return <DramaHub onNavigate={setView} />;
  if (view === "script") return <ScriptPage onNavigate={setView} />;
  if (view === "assets") return <AssetsPage onNavigate={setView} />;
  if (view === "videos") return <VideosPage onNavigate={setView} />;
  if (view === "editor") return <EditorPage onNavigate={setView} />;
  if (view === "canvas") return <FreeCanvasPage onNavigate={setView} />;
  return <GlobalAssets onNavigate={setView} />;
}

