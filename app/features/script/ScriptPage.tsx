"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import type { ProjectEpisode, ProjectSummary, View } from "../studio/types";

type ProjectDetailResponse = {
  project: ProjectSummary;
  episodes: ProjectEpisode[];
};

export function ScriptPage({ onNavigate, projectId }: { onNavigate: (view: View) => void; projectId: string | null }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [episodes, setEpisodes] = useState<ProjectEpisode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"原始创意" | "剧本摘要" | "分集剧本">("分集剧本");
  const [scriptText, setScriptText] = useState("");
  const [loading, setLoading] = useState(Boolean(projectId));
  const [saveState, setSaveState] = useState<"已保存" | "保存中" | "保存失败">("已保存");
  const [error, setError] = useState("");

  const selectedEpisode = useMemo(
    () => episodes.find((episode) => episode.id === selectedEpisodeId) ?? episodes[0] ?? null,
    [episodes, selectedEpisodeId],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("项目加载失败");
        const data = await response.json() as ProjectDetailResponse;
        if (cancelled) return;
        setProject(data.project);
        setEpisodes(data.episodes ?? []);
        const first = data.episodes?.[0];
        setSelectedEpisodeId(first?.id ?? null);
        setScriptText(first?.scriptText ?? "");
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "项目加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  const chooseEpisode = (episode: ProjectEpisode) => {
    setSelectedEpisodeId(episode.id);
    setScriptText(episode.scriptText ?? "");
    setSaveState("已保存");
  };

  useEffect(() => {
    if (!projectId || !selectedEpisode || scriptText === (selectedEpisode.scriptText ?? "")) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scriptText, status: "editing" }),
        });
        if (!response.ok) throw new Error("保存失败");
        const data = await response.json() as { episode?: ProjectEpisode };
        if (data.episode) setEpisodes((current) => current.map((episode) => episode.id === data.episode!.id ? data.episode! : episode));
        setSaveState("已保存");
      } catch {
        setSaveState("保存失败");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, scriptText, selectedEpisode]);

  const confirmScript = async () => {
    if (!projectId || !selectedEpisode) return;
    setSaveState("保存中");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptText, status: "confirmed" }),
      });
      if (!response.ok) throw new Error("剧本确认失败");
      setEpisodes((current) => current.map((episode) => episode.id === selectedEpisode.id ? { ...episode, scriptText, status: "confirmed" } : episode));
      const extraction = await fetch(`/api/projects/${projectId}/extract-assets`, { method: "POST" });
      if (!extraction.ok) {
        const data = await extraction.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "角色与场景提取失败");
      }
      setSaveState("已保存");
      onNavigate("assets");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本确认失败");
      setSaveState("保存失败");
    }
  };

  if (!projectId) {
    return (
      <StudioShell view="script" onNavigate={onNavigate}>
        <div className="missing-project"><b>还没有选择短剧项目</b><p>请从“我的短剧”打开一个项目，或先创建新项目。</p><AppButton primary onClick={() => onNavigate("drama")}>返回短剧 Agent</AppButton></div>
      </StudioShell>
    );
  }

  return (
    <StudioShell view="script" onNavigate={onNavigate}>
      <ProjectTop step={1} onNavigate={onNavigate} title={project?.title} stylePreset={project?.stylePreset} aspectRatio={project?.aspectRatio} saveState={saveState} />
      <div className="project-body script-body">
        <aside className="episode-sidebar">
          <div><h3>分集剧本</h3><Pill>{episodes.length} 集</Pill></div>
          {episodes.map((episode) => (
            <button key={episode.id} className={selectedEpisode?.id === episode.id ? "active" : ""} onClick={() => chooseEpisode(episode)}>
              <span>{String(episode.episodeNumber).padStart(2, "0")}</span>
              <div><b>{episode.title}</b><small>{episode.status === "confirmed" ? "已确认" : episode.scriptText ? "编辑中" : "待生成"}</small></div>
              <i className={episode.scriptText ? "ready" : "pending"} />
            </button>
          ))}
          <button className="add-episode" disabled>＋ 新增一集（即将开放）</button>
        </aside>
        <main className="script-workspace">
          {loading ? (
            <div className="script-loading">正在读取剧本…</div>
          ) : error && !project ? (
            <div className="script-loading error">{error}</div>
          ) : (
            <>
              <div className="workspace-header">
                <div><p className="eyebrow">第 {selectedEpisode?.episodeNumber ?? 1} 集</p><h2>{selectedEpisode?.title ?? "第 1 集"}</h2></div>
                <div><span className={`autosave-state ${saveState === "保存失败" ? "error" : ""}`}>{saveState}</span><AppButton disabled>重新生成</AppButton></div>
              </div>
              <div className="content-tabs">
                {(["原始创意", "剧本摘要", "分集剧本"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
              </div>
              {tab === "原始创意" && <div className="summary-card"><h3>原始创意</h3><p>{project?.synopsis || "上传剧本创建的项目，原始内容保存在分集剧本中。"}</p></div>}
              {tab === "剧本摘要" && <div className="summary-card"><h3>剧本摘要</h3><p>{selectedEpisode?.summary || "摘要尚未生成。后续将由剧本能力根据当前分集内容生成，并保留人工修改入口。"}</p></div>}
              {tab === "分集剧本" && (
                <div className="episode-script editor-mode">
                  {selectedEpisode?.status === "confirmed" && <div className="lock-banner"><span>✓</span><div><b>本集剧本已确认</b><p>继续修改会自动保存，进入资产提取时以最新内容为准。</p></div></div>}
                  <textarea
                    className="script-text-editor"
                    aria-label="分集剧本内容"
                    value={scriptText}
                    onChange={(event) => { setScriptText(event.target.value); setSaveState("保存中"); }}
                    placeholder={project?.sourceType === "ai_script" ? "故事设定已保存。AI 剧本生成能力接入后会在这里写入分集内容，你也可以现在直接创作。" : "在这里粘贴或编写本集剧本…"}
                  />
                  <div className="script-count">{scriptText.length.toLocaleString()} 字</div>
                </div>
              )}
              {error && <p className="project-form-error" role="alert">{error}</p>}
              <div className="script-footer">
                <div><span className="status-dot" />剧本内容已保存到当前账号的项目</div>
                <AppButton primary disabled={!scriptText.trim() || saveState === "保存中"} onClick={confirmScript}>确认剧本，进入资产库 →</AppButton>
              </div>
            </>
          )}
        </main>
      </div>
    </StudioShell>
  );
}
