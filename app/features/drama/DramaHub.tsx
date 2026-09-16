"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { projectAspectRatios, projectStylePresets } from "../../lib/project-presets";
import type { ProjectSummary, View } from "../studio/types";

export type CreationMode = "上传剧本" | "AI 生剧本" | "自由画布";

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

function projectResumeTarget(project: ProjectSummary): View {
  if (project.sourceType === "canvas" && project.status === "draft") return "canvas";
  if (["assets", "asset_extraction", "asset_review"].includes(project.status)) return "assets";
  if (["storyboarding", "production", "rendering", "rendered", "delivered"].includes(project.status)) return "videos";
  return "script";
}

export function DramaHub({
  onNavigate,
  onOpenProject,
  initialMode = "上传剧本",
}: {
  onNavigate: (view: View) => void;
  onOpenProject: (project: ProjectSummary, target: View) => void;
  initialMode?: CreationMode;
}) {
  const [mode, setMode] = useState<CreationMode>(initialMode);
  const [title, setTitle] = useState(defaultTitles[initialMode]);
  const [text, setText] = useState("");
  const [episodeCount, setEpisodeCount] = useState(3);
  const [stylePreset, setStylePreset] = useState<(typeof projectStylePresets)[number]>(projectStylePresets[0]);
  const [aspectRatio, setAspectRatio] = useState<(typeof projectAspectRatios)[number]>(projectAspectRatios[0]);
  const [sourceFileName, setSourceFileName] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
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

  const deleteProject = async (project: ProjectSummary) => {
    if (deletingProjectId) return;
    if (!window.confirm(`确定删除「${project.title}」吗？项目内的剧本、资产和生成记录都会被永久删除。`)) return;
    setDeletingProjectId(project.id);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "项目删除失败");
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目删除失败");
    } finally {
      setDeletingProjectId(null);
    }
  };

  const canCreate = useMemo(() => {
    if (!title.trim()) return false;
    return mode === "自由画布" || Boolean(text.trim());
  }, [mode, text, title]);

  const selectMode = (nextMode: CreationMode) => {
    setMode(nextMode);
    if (!title.trim() || Object.values(defaultTitles).includes(title)) setTitle(defaultTitles[nextMode]);
    setError("");
  };

  const readScriptFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) {
      setError("剧本文件不能超过 5 MB");
      return;
    }
    if (!/\.(txt|md)$/i.test(file.name)) {
      setError("当前已真实支持 TXT 和 Markdown；DOCX、PDF 解析尚未接入");
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error("文件内容为空");
      setText(content.slice(0, 100_000));
      setSourceFileName(file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本文件读取失败");
    }
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
          stylePreset,
          aspectRatio,
          episodeCount: mode === "AI 生剧本" ? episodeCount : undefined,
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
          <div className="project-creation-settings"><label>视觉类型<select value={stylePreset} onChange={(event) => setStylePreset(event.target.value as typeof stylePreset)}>{projectStylePresets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>成片画幅<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}>{projectAspectRatios.map((item) => <option key={item} value={item}>{item}{item === "9:16" ? " · 竖屏短剧" : item === "16:9" ? " · 横屏" : " · 方形"}</option>)}</select></label><span>设置会写入项目，并贯穿角色、场景、分镜和视频生成。</span></div>
          {mode === "上传剧本" && (
            <div className="upload-layout">
              <label className={`upload-zone ${sourceFileName ? "has-file" : ""}`}>
                <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void readScriptFile(event.target.files?.[0])} />
                <span className="upload-icon">{sourceFileName ? "✓" : "⇧"}</span><h3>{sourceFileName || "上传完整剧本"}</h3><p>真实支持 TXT、Markdown，最大 5 MB</p><em>{sourceFileName ? `${text.length.toLocaleString()} 字已载入` : "也可以在右侧直接粘贴剧本"}</em>
              </label>
              <div className="or-divider"><span>或</span></div>
              <div className="paste-area">
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="直接粘贴剧本文本…" />
                <div><span>{text.length} 字</span><AppButton primary disabled={!canCreate || creating} onClick={createProject}>{creating ? "文本智能正在整理分集…" : "整理分集并创建项目 →"}</AppButton></div>
              </div>
            </div>
          )}
          {mode === "AI 生剧本" && (
            <div className="ai-script-panel">
              <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="描述故事主题、人物关系和想要的情绪…" />
              <div className="ai-options"><label className="ai-episode-count">集数<select value={episodeCount} onChange={(event) => setEpisodeCount(Number(event.target.value))}>{[1, 3, 5, 10, 30].map((count) => <option key={count} value={count}>{count} 集</option>)}</select></label><span>{stylePreset} · {aspectRatio}</span></div>
              <p className="ai-real-generation-note">将调用“生产引擎”中已配置的文本智能模型，并把每一集真实保存到当前账号。</p>
              <AppButton primary disabled={!canCreate || creating} onClick={createProject}>{creating ? "AI 正在生成分集剧本…" : "生成剧本并创建项目 →"}</AppButton>
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
              {projects.map((project) => (
                <article className="project-card" key={project.id}>
                  <button type="button" className="project-card-open" onClick={() => onOpenProject(project, projectResumeTarget(project))}>
                    <div className={`project-cover truthful-project-cover ${project.sourceType}-cover`}>
                      <strong>{project.title.trim().slice(0, 1) || "象"}</strong>
                      <span>{project.sourceType === "canvas" && project.status === "draft" ? "自由画布" : project.status === "script_structuring" ? "正在整理分集" : project.status === "script_generating" ? "剧本生成中" : ["script_structure_failed", "script_generation_failed", "script_analysis_failed"].includes(project.status) ? "剧本任务需重试" : project.status === "scripting" ? "剧本编辑中" : ["assets", "asset_extraction", "asset_review"].includes(project.status) ? "资产准备中" : project.status === "storyboarding" ? "分镜制作中" : project.status === "production" ? "片段制作中" : project.status === "rendering" ? "整集合成中" : project.status === "rendered" ? "整剧已成片" : project.status === "delivered" ? "已生成整剧交付包" : project.status}</span>
                    </div>
                    <div className="project-info"><h3>{project.title}</h3><p>{project.stylePreset} · {project.aspectRatio}</p><small>{formatUpdatedAt(project.updatedAt)}</small></div>
                  </button>
                  <button
                    type="button"
                    className="project-card-delete"
                    aria-label={`删除 ${project.title}`}
                    disabled={deletingProjectId === project.id}
                    onClick={() => void deleteProject(project)}
                  >
                    {deletingProjectId === project.id ? "删除中…" : "删除"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
