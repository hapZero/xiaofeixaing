"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import { videoImages } from "../studio/media";
import type { ProjectAsset, ProjectCharacter, ProjectEpisode, ProjectShot, ProjectSummary, View } from "../studio/types";

type VideoProjectDetail = {
  project: ProjectSummary;
  episodes: ProjectEpisode[];
  assets: ProjectAsset[];
  characters: ProjectCharacter[];
  shots: ProjectShot[];
};

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function VideosPage({ onNavigate, project: initialProject }: { onNavigate: (view: View) => void; project: ProjectSummary | null }) {
  const [detail, setDetail] = useState<VideoProjectDetail | null>(null);
  const [previewEpisodeId, setPreviewEpisodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(initialProject));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const projectId = initialProject?.id ?? null;

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("分镜项目加载失败");
      setDetail(await response.json() as VideoProjectDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜项目加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("分镜项目加载失败");
        return response.json() as Promise<VideoProjectDetail>;
      })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "分镜项目加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const generateStoryboards = async () => {
    if (!projectId) return;
    setGenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/storyboards`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "分镜脚本生成失败");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜脚本生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const selectedEpisode = detail?.episodes.find((episode) => episode.id === previewEpisodeId) ?? null;
  const selectedShots = selectedEpisode ? detail?.shots.filter((shot) => shot.episodeId === selectedEpisode.id).sort((a, b) => a.sequence - b.sequence) ?? [] : [];
  const totalDuration = useMemo(() => detail?.shots.reduce((sum, shot) => sum + shot.durationMs, 0) ?? 0, [detail]);

  if (!initialProject) {
    return <StudioShell view="videos" onNavigate={onNavigate}><div className="missing-project"><b>还没有选择短剧项目</b><p>请先打开项目并完成剧本与资产设置。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></StudioShell>;
  }

  return (
    <StudioShell view="videos" onNavigate={onNavigate}>
      <ProjectTop step={3} onNavigate={onNavigate} title={detail?.project.title ?? initialProject.title} stylePreset={detail?.project.stylePreset ?? initialProject.stylePreset} aspectRatio={detail?.project.aspectRatio ?? initialProject.aspectRatio} saveState="分镜脚本已保存" />
      <div className="videos-page page-scroll">
        <div className="videos-heading"><div><p className="eyebrow">分集视频</p><h2>{detail?.episodes.length ?? 0} 集 · {detail?.shots.length ?? 0} 个分镜片段</h2><p>先检查分镜脚本与声音继承关系，再提交 ComfyUI 生成首帧和视频。</p></div><div><AppButton onClick={() => void load()}>刷新</AppButton><AppButton primary disabled={generating} onClick={generateStoryboards}>{generating ? "正在拆分…" : "生成分镜脚本"}</AppButton></div></div>
        {loading ? <div className="project-empty">正在读取分镜脚本…</div> : detail?.shots.length ? (
          <div className="episode-video-list">
            {detail.episodes.map((episode, index) => {
              const episodeShots = detail.shots.filter((shot) => shot.episodeId === episode.id);
              const duration = episodeShots.reduce((sum, shot) => sum + shot.durationMs, 0);
              const inheritedAudio = episodeShots.filter((shot) => shot.environmentPresetId).length;
              return (
                <article className="episode-video-card" key={episode.id}>
                  <button className="episode-thumb storyboard-ready" style={{ backgroundImage: `url(${videoImages[index % videoImages.length]})` }} onClick={() => setPreviewEpisodeId(episode.id)}><span className="storyboard-count">{episodeShots.length}<small>个分镜</small></span><time>{formatDuration(duration)}</time></button>
                  <div className="episode-video-info"><div className="episode-state"><span>✓ 分镜脚本已生成</span><small>{inheritedAudio}/{episodeShots.length} 个分镜继承场景声音场</small></div><p>第 {episode.episodeNumber} 集</p><h3>{episode.title}</h3><div className="episode-stats"><span>角色 {detail.characters.length}</span><i /><span>场景 {detail.assets.filter((asset) => asset.assetType === "scene").length}</span><i /><span>分镜 {episodeShots.length}</span></div></div>
                  <div className="episode-actions"><AppButton onClick={() => setPreviewEpisodeId(episode.id)}>查看脚本</AppButton><AppButton primary onClick={() => onNavigate("editor")}>编辑分镜</AppButton><button className="more-button">···</button></div>
                </article>
              );
            })}
          </div>
        ) : <div className="asset-empty-state"><div>镜</div><h3>还没有分镜脚本</h3><p>完成角色音色和场景声音场配置后，小飞象会按照分集剧本拆分镜头。</p><AppButton primary onClick={generateStoryboards}>生成分镜脚本</AppButton></div>}
        {error && <p className="project-form-error asset-error" role="alert">{error}</p>}
        <div className="videos-footer"><AppButton onClick={() => onNavigate("assets")}>← 上一步</AppButton><div><span><i className="status-dot" />分镜预计总时长 {formatDuration(totalDuration)}</span><AppButton primary disabled={!detail?.shots.length} onClick={() => detail?.episodes[0] && setPreviewEpisodeId(detail.episodes[0].id)}>检查全部分镜 →</AppButton></div></div>
      </div>
      {selectedEpisode && <div className="modal-backdrop" onMouseDown={() => setPreviewEpisodeId(null)}><div className="storyboard-preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">第 {selectedEpisode.episodeNumber} 集</p><h2>{selectedEpisode.title}</h2></div><button onClick={() => setPreviewEpisodeId(null)}>×</button></div><div className="storyboard-preview-list">{selectedShots.map((shot) => <article key={shot.id}><span>{String(shot.sequence).padStart(2, "0")}</span><div><h3>{shot.title}</h3><p>{shot.prompt}</p><small>{Math.round(shot.durationMs / 1_000)} 秒 · {shot.environmentPresetId ? "已继承场景声音场" : "未匹配声音场"}</small></div></article>)}</div><div className="modal-footer"><AppButton onClick={() => setPreviewEpisodeId(null)}>关闭</AppButton><AppButton primary onClick={() => { setPreviewEpisodeId(null); onNavigate("editor"); }}>进入分镜编辑</AppButton></div></div></div>}
    </StudioShell>
  );
}
