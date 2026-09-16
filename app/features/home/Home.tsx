"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { useSettings } from "../settings/SettingsProvider";
import { projectAspectRatios, projectStylePresets } from "../../lib/project-presets";
import type { ProjectSummary, View } from "../studio/types";
import type { CreationMode } from "../drama/DramaHub";

export function Home({ onNavigate, onOpenProject, onStartCreation }: { onNavigate: (view: View) => void; onOpenProject: (project: ProjectSummary, target: View) => void; onStartCreation: (mode: CreationMode) => void }) {
  const { openSettings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [stylePreset, setStylePreset] = useState<(typeof projectStylePresets)[number]>(projectStylePresets[0]);
  const [aspectRatio, setAspectRatio] = useState<(typeof projectAspectRatios)[number]>(projectAspectRatios[0]);
  const [error, setError] = useState("");

  const createFromIdea = async () => {
    const idea = prompt.trim();
    if (!idea || creating) {
      if (!idea) setError("请先写下你想创作的故事");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "新的 AI 短剧", sourceType: "ai_script", synopsis: idea, episodeCount: 3, stylePreset, aspectRatio }),
      });
      const data = await response.json() as { project?: ProjectSummary; error?: { message?: string } };
      if (!response.ok || !data.project) throw new Error(data.error?.message ?? "剧本生成失败");
      onOpenProject(data.project, "script");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本生成失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <StudioShell view="home" onNavigate={onNavigate}>
      <div className="home-page page-scroll">
        <section className="agent-hero">
          <p className="eyebrow">小飞象短剧 Agent</p>
          <h1>今天想把什么故事拍出来？</h1>
          <div className="composer-card">
            <textarea aria-label="描述你的短剧创意" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述故事主题、人物关系和想要的情绪…" />
            <div className="composer-bottom">
              <div className="home-quick-settings"><select aria-label="视觉类型" value={stylePreset} onChange={(event) => setStylePreset(event.target.value as typeof stylePreset)}>{projectStylePresets.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="成片画幅" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}>{projectAspectRatios.map((item) => <option key={item}>{item}</option>)}</select><p className="home-real-route-note">真实生成三集可编辑剧本</p></div>
              <button className="send-button" aria-label="生成短剧剧本" disabled={creating} onClick={() => void createFromIdea()}>{creating ? "…" : "↑"}</button>
            </div>
          </div>
          {error && <div className="home-idea-error" role="alert"><span>{error}</span><button type="button" onClick={() => openSettings("text")}>打开设置</button></div>}
          <div className="prompt-chips">
            <button onClick={() => setPrompt("做一个发生在废弃学校里的悬疑短剧")}>废弃学校悬疑短剧</button>
            <button onClick={() => setPrompt("一位古代将军穿越到现代便利店")}>古代将军来到便利店</button>
          </div>
        </section>
        <section className="home-section">
          <div className="section-title"><div><h2>开始创作</h2><p>选择适合你的方式，创建或继续一个真实短剧项目</p></div></div>
          <div className="tool-grid truthful-tool-grid">
            <button className="tool-card drama-feature" onClick={() => onStartCreation("上传剧本")}><span className="tool-icon tool-drama">▣</span><div><div className="mini-tag">核心主线</div><h3>短剧 Agent</h3><p>从想法或剧本开始，进入资产、分集、片段和成片流程</p></div><b>↗</b></button>
            <button className="tool-card canvas-feature" onClick={() => onStartCreation("自由画布")}><span className="tool-icon tool-canvas">⌘</span><div><h3>自由画布</h3><p>创建画布项目，直接组织角色、场景、文本、图片、音频和视频节点</p></div><b>↗</b></button>
          </div>
        </section>
      </div>
    </StudioShell>
  );
}
