"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { videoImages } from "../studio/media";
import type { ProjectSummary, View } from "../studio/types";

type CreationMode = "上传剧本" | "AI 生剧本" | "自由画布";

const sourceTypes: Record<CreationMode, ProjectSummary["sourceType"]> = {
  "上传剧本": "upload",
  "AI 生剧本": "ai_script",
  "自由画布": "canvas",
};

const defaultTitles: Record<CreationMode, string> = {
  "上传剧本": "未命名短剧",
  "AI 生剧本": "新的 AI 短剧",
  "自由画布": "新的自由画布",
};

function formatUpdatedAt(value: ProjectSummary["updatedAt"]): string {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  if (!Number.isFinite(difference)) return "刚刚更新";
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}

export function DramaHub({
  onNavigate,
  onOpenProject,
}: {
  onNavigate: (view: View) => void;
  onOpenProject: (project: ProjectSummary, target: View) => void;
}) {
  const [mode, setMode] = useState<CreationMode>("上传剧本");
  const [title, setTitle] = useState(defaultTitles["上传剧本"]);
  const [text, setText] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error("项目列表加载失败");
      const data = await response.json() as { projects?: ProjectSummary[] };
      setProjects(data.projects ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目列表加载失败");
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("项目列表加载失败");
        return response.json() as Promise<{ projects?: ProjectSummary[] }>;
      })
      .then((data) => { if (!cancelled) setProjects(data.projects ?? []); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "项目列表加载失败"); })
      .finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, []);

  const canCreate = useMemo(() => {
    if (!title.trim()) return false;
    return mode === "自由画布" || Boolean(text.trim());
  }, [mode, text, title]);

  const selectMode = (nextMode: CreationMode) => {
    setMode(nextMode);
    if (!title.trim() || Object.values(defaultTitles).includes(title)) setTitle(defaultTitles[nextMode]);
    setError("");
  };

  const createProject = async () => {
    if (!canCreate) {
      setError(mode === "自由画布" ? "请输入项目名称" : "请输入项目名称和创作内容");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const sourceType = sourceTypes[mode];
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sourceType,
          synopsis: mode === "AI 生剧本" ? text.trim() : undefined,
          initialScript: mode === "上传剧本" ? text.trim() : undefined,
          stylePreset: "写实电影风格",
          aspectRatio: "16:9",
        }),
      });
      const data = await response.json() as { project?: ProjectSummary; error?: { message?: string } };
      if (!response.ok || !data.project) throw new Error(data.error?.message ?? "项目创建失败");
      setProjects((current) => [data.project!, ...current]);
      onOpenProject(data.project, sourceType === "canvas" ? "canvas" : "script");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <StudioShell view="drama" onNavigate={onNavigate}>
      <div className="drama-page page-scroll">
        <section className="drama-header">
          <Pill>短剧 Agent 2.0</Pill>
          <h1>把故事交给小飞象，<br />一个人也能完成一部短剧。</h1>
          <p>从剧本拆解、角色资产到分镜成片，保留每一步创作控制权。</p>
        </section>
        <section className="create-project-panel">
          <div className="create-tabs">
            {(["上传剧本", "AI 生剧本", "自由画布"] as const).map((tab) => (
              <button key={tab} className={mode === tab ? "active" : ""} onClick={() => selectMode(tab)}>{tab}</button>
            ))}
          </div>
          <div className="project-title-row">
            <label htmlFor="project-title">项目名称</label>
            <input id="project-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
          </div>
          {mode === "上传剧本" && (
            <div className="upload-layout">
              <button className="upload-zone" onClick={() => setText("第1集：旧教室重逢揭开尘封往事……") }>
                <span className="upload-icon">⇧</span><h3>上传完整剧本</h3><p>支持 TXT、DOCX、PDF，或拖拽文件到这里</p><em>当前可先粘贴文本，文件解析随后接入</em>
              </button>
              <div className="or-divider"><span>或</span></div>
              <div className="paste-area">
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="直接粘贴剧本文本…" />
                <div><span>{text.length} 字</span><AppButton primary disabled={!canCreate || creating} onClick={createProject}>{creating ? "正在创建…" : "创建短剧项目 →"}</AppButton></div>
              </div>
            </div>
          )}
          {mode === "AI 生剧本" && (
            <div className="ai-script-panel">
              <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="描述故事主题、人物关系和想要的情绪…" />
              <div className="ai-options"><Pill>写实电影风格⌄</Pill><Pill>16:9⌄</Pill><Pill>3 集⌄</Pill><Pill>悬疑短剧⌄</Pill></div>
              <AppButton primary disabled={!canCreate || creating} onClick={createProject}>{creating ? "正在创建…" : "创建并生成大纲 →"}</AppButton>
            </div>
          )}
          {mode === "自由画布" && (
            <div className="free-canvas-intro">
              <div className="canvas-preview-mini"><span /><span /><span /><i /><i /></div>
              <div><h3>不从剧本开始，也可以创作</h3><p>先创建项目，再在自由画布里上传角色、场景和灵感素材；节点与连线都会自动保存。</p><AppButton primary disabled={!canCreate || creating} onClick={createProject}>{creating ? "正在创建…" : "创建并进入画布 →"}</AppButton></div>
            </div>
          )}
          {error && <p className="project-form-error" role="alert">{error}</p>}
        </section>
        <section className="project-section">
          <div className="section-title"><div><h2>我的短剧</h2><p>账号下最近更新的创作项目</p></div><button onClick={() => void loadProjects()}>刷新 ↻</button></div>
          {loadingProjects ? (
            <div className="project-empty">正在读取项目…</div>
          ) : projects.length === 0 ? (
            <div className="project-empty"><b>还没有短剧项目</b><span>从上面的三种方式选择一种开始创作。</span></div>
          ) : (
            <div className="project-grid">
              {projects.map((project, index) => (
                <button className="project-card" key={project.id} onClick={() => onOpenProject(project, project.sourceType === "canvas" ? "canvas" : "script")}>
                  <div className={`project-cover ${index % 3 === 2 ? "warm-cover" : ""}`} style={index % 3 === 2 ? undefined : { backgroundImage: `url(${videoImages[index % videoImages.length]})` }}>
                    <span>{project.sourceType === "canvas" ? "自由画布" : project.status === "scripting" ? "剧本编辑中" : "制作中"}</span>
                    <div className="project-progress"><i style={{ width: project.sourceType === "canvas" ? "18%" : "32%" }} /></div>
                  </div>
                  <div className="project-info"><h3>{project.title}</h3><p>{project.stylePreset} · {project.aspectRatio}</p><small>{formatUpdatedAt(project.updatedAt)}</small></div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
