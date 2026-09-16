"use client";

import { useEffect, useMemo, useState } from "react";
import { getStoryboardGenerationBlockers } from "../../lib/storyboard-readiness";
import { StudioShell } from "../../components/layout/StudioShell";
import { useSettings } from "../settings/SettingsProvider";
import { AppButton } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import type { ProjectProductionDetail, ProjectSummary, View } from "../studio/types";

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

type ProjectExportResult = { assetId?: string; url?: string; name?: string; size?: number; entryCount?: number; episodeCount?: number };
type ProjectExportRecord = { id: string; status: string; progress: number; errorCode: string | null; errorMessage: string | null; result: ProjectExportResult | null; createdAt: string | number | Date; finishedAt: string | number | Date | null };
type ProjectExportState = { readiness: "empty" | "blocked" | "ready"; blockedReason: string | null; episodeCount: number; readyEpisodeCount: number; missingEpisodes: Array<{ id: string; episodeNumber: number; title: string }>; activeJob: ProjectExportRecord | null; records: ProjectExportRecord[] };
type EpisodeBatchState = {
  status: "idle" | "running" | "failed" | "cancelled" | "complete";
  batch: { id: string; status: string; progress: number; currentSegmentId: string | null; currentIndex: number; total: number; currentAttempted: boolean } | null;
  currentSegment: { id: string; sequence: number; title: string; status: string; videoAssetId: string | null } | null;
  progress: { ready: number; total: number };
  lastFailure: { code?: string | null; message?: string | null; segmentId?: string | null } | null;
  error?: { code?: string; message?: string };
};
type SegmentBatchStatus = {
  segment?: { id: string; status: string; videoAssetId: string | null };
  stage?: string | null;
  activeJob?: { id: string; capability: string; status: string } | null;
  mediaJob?: { id: string; status: string; progress: number } | null;
  resumeRequired?: boolean;
  lastFailure?: { errorCode?: string | null; errorMessage?: string | null } | null;
  error?: { code?: string; message?: string };
};
type SoundBatchStatus = {
  status?: "complete" | "running" | "ready_to_continue" | "waiting_video";
  activeJob?: { id: string; capability: string; status: string } | null;
  mediaJob?: { id: string; operation: string; status: string; progress: number; errorMessage?: string | null } | null;
  blockers?: Array<{ name: string; reason: string }>;
  error?: { code?: string; message?: string };
};

export function VideosPage({ onNavigate, onOpenEditor, project: initialProject }: { onNavigate: (view: View) => void; onOpenEditor: (episodeId: string) => void; project: ProjectSummary | null }) {
  const { openSettings } = useSettings();
  const [detail, setDetail] = useState<ProjectProductionDetail | null>(null);
  const [previewEpisodeId, setPreviewEpisodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(initialProject));
  const [generating, setGenerating] = useState(false);
  const [renderingEpisodeId, setRenderingEpisodeId] = useState<string | null>(null);
  const [renderPollTick, setRenderPollTick] = useState(0);
  const [renderStatus, setRenderStatus] = useState("");
  const [previewEpisodeVersionAssetId, setPreviewEpisodeVersionAssetId] = useState<string | null>(null);
  const [subtitleStyle, setSubtitleStyle] = useState<"short_drama" | "cinematic" | "minimal">("short_drama");
  const [qualityPendingSegmentIds, setQualityPendingSegmentIds] = useState<string[]>([]);
  const [projectExport, setProjectExport] = useState<ProjectExportState | null>(null);
  const [exportingProject, setExportingProject] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [batchEpisodeId, setBatchEpisodeId] = useState<string | null>(null);
  const [episodeBatch, setEpisodeBatch] = useState<EpisodeBatchState | null>(null);
  const [batchMessage, setBatchMessage] = useState("");
  const [batchTick, setBatchTick] = useState(0);
  const [error, setError] = useState("");
  const projectId = initialProject?.id ?? null;
  const episodeIdsKey = detail?.episodes.map((episode) => episode.id).join(",") ?? "";

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("分镜项目加载失败");
      setDetail(await response.json() as ProjectProductionDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜项目加载失败");
    } finally {
      setLoading(false);
    }
  };

  const readEpisodeBatch = async (episodeId: string) => {
    if (!projectId) throw new Error("项目尚未加载");
    const response = await fetch(`/api/projects/${projectId}/episodes/${episodeId}/produce`, { cache: "no-store" });
    const data = await response.json() as EpisodeBatchState;
    if (!response.ok) throw new Error(data.error?.message ?? "分集批量生产状态读取失败");
    return data;
  };

  const writeEpisodeBatch = async (episodeId: string, body: Record<string, unknown>) => {
    if (!projectId) throw new Error("项目尚未加载");
    const response = await fetch(`/api/projects/${projectId}/episodes/${episodeId}/produce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as EpisodeBatchState;
    if (!response.ok) throw new Error(data.error?.message ?? "分集批量生产操作失败");
    return data;
  };

  const startEpisodeBatch = async (episodeId: string) => {
    setBatchEpisodeId(episodeId);
    setEpisodeBatch(null);
    setBatchMessage("正在建立可恢复的分集生产批次…");
    setError("");
    try {
      const data = await writeEpisodeBatch(episodeId, { action: "start" });
      setEpisodeBatch(data);
      setBatchMessage(data.status === "complete" ? "本集全部片段已经完成" : "批次已建立，正在检查第一个待生产片段");
      setBatchTick((current) => current + 1);
    } catch (reason) {
      setBatchMessage("");
      setError(reason instanceof Error ? reason.message : "分集批量生产启动失败");
    }
  };

  const cancelEpisodeBatch = async () => {
    if (!batchEpisodeId || episodeBatch?.status !== "running") return;
    try {
      const data = await writeEpisodeBatch(batchEpisodeId, { action: "cancel", segmentId: episodeBatch.batch?.currentSegmentId });
      setEpisodeBatch(data);
      setBatchMessage("批量生产已停止；已完成片段和正在 Spark 中执行的任务不会被删除");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "停止批量生产失败");
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("分镜项目加载失败");
        return response.json() as Promise<ProjectProductionDetail>;
      })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "分镜项目加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !episodeIdsKey || batchEpisodeId) return;
    let cancelled = false;
    Promise.all(episodeIdsKey.split(",").map(async (episodeId) => ({ episodeId, state: await readEpisodeBatch(episodeId) })))
      .then((states) => {
        if (cancelled) return;
        const running = states.find((item) => item.state.status === "running");
        if (!running) return;
        setBatchEpisodeId(running.episodeId);
        setEpisodeBatch(running.state);
        setBatchMessage("已恢复上次未完成的分集生产批次");
        setBatchTick((current) => current + 1);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [batchEpisodeId, episodeIdsKey, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer = 0;
    let observedActive = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/export`, { cache: "no-store" });
        if (!response.ok) throw new Error("整剧导出状态读取失败");
        const data = await response.json() as ProjectExportState;
        if (cancelled) return;
        setProjectExport(data);
        if (data.activeJob) {
          observedActive = true;
          setExportStatus(`整剧交付包正在生成 · ${data.activeJob.progress}%`);
        } else if (observedActive) {
          observedActive = false;
          const latest = data.records[0];
          setExportStatus(latest?.status === "succeeded" ? "整剧交付包已生成，可以下载" : latest?.status === "failed" ? `整剧交付失败：${latest.errorMessage ?? "请检查媒体服务和分集文件"}` : "");
          const detailResponse = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
          if (detailResponse.ok && !cancelled) setDetail(await detailResponse.json() as ProjectProductionDetail);
        }
        timer = window.setTimeout(poll, data.activeJob ? 1_600 : 8_000);
      } catch (reason) {
        if (!cancelled) setExportStatus(reason instanceof Error ? reason.message : "整剧导出状态读取失败");
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !batchEpisodeId || episodeBatch?.status !== "running") return;
    let cancelled = false;
    let timer = 0;
    const generationMessage = async (jobId: string, stage: string, segmentLabel: string) => {
      const response = await fetch(`/api/generation/jobs/${jobId}`, { cache: "no-store" });
      const data = await response.json() as { job?: { status?: string; errorCode?: string | null; errorMessage?: string | null; progress?: { overall?: number; stage?: string; currentNodeTitle?: string } }; error?: { code?: string; message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "生成任务状态读取失败");
      if (data.job?.status === "failed") return `${segmentLabel}失败：${data.job.errorMessage ?? "Spark 生成失败"}`;
      const progress = Math.round(data.job?.progress?.overall ?? 0);
      const node = data.job?.progress?.currentNodeTitle;
      return `${segmentLabel} · ${data.job?.progress?.stage ?? stage}${node ? ` · ${node}` : ""}${progress ? ` · ${progress}%` : ""}`;
    };
    const observe = async () => {
      try {
        const latest = await readEpisodeBatch(batchEpisodeId);
        if (cancelled) return;
        setEpisodeBatch(latest);
        if (latest.status === "complete") {
          setBatchMessage("本集全部片段已完成，可以逐片段审片并合成整集");
          await load();
          return;
        }
        if (latest.status === "failed") {
          setBatchMessage(latest.lastFailure?.message ? `批次失败：${latest.lastFailure.message}` : "批量生产已停止在失败片段");
          return;
        }
        const segmentId = latest.batch?.currentSegmentId;
        if (!segmentId) return;
        const segmentLabel = latest.currentSegment ? `片段 ${String(latest.currentSegment.sequence).padStart(2, "0")} · ${latest.currentSegment.title}` : "当前片段";
        const segmentResponse = await fetch(`/api/projects/${projectId}/segments/${segmentId}/generate`, { cache: "no-store" });
        const segmentState = await segmentResponse.json() as SegmentBatchStatus;
        if (!segmentResponse.ok) throw new Error(segmentState.error?.message ?? "片段生产状态读取失败");
        if (segmentState.activeJob) {
          setBatchMessage(await generationMessage(segmentState.activeJob.id, segmentState.stage ?? "正在生成片段", segmentLabel));
        } else if (segmentState.mediaJob) {
          setBatchMessage(`${segmentLabel} · 正在合成多个分镜 · ${segmentState.mediaJob.progress ?? 5}%`);
        } else if (!segmentState.segment?.videoAssetId) setBatchMessage(`${segmentLabel} · 后台执行器正在准备片段视频`);
        else {
          const soundResponse = await fetch(`/api/projects/${projectId}/segments/${segmentId}/sound`, { cache: "no-store" });
          const soundState = await soundResponse.json() as SoundBatchStatus;
          if (!soundResponse.ok) throw new Error(soundState.error?.message ?? "片段声音状态读取失败");
          if (soundState.activeJob) setBatchMessage(await generationMessage(soundState.activeJob.id, "正在生成片段声音", segmentLabel));
          else if (soundState.mediaJob?.status === "running") setBatchMessage(`${segmentLabel} · 正在处理声音与画面 · ${soundState.mediaJob.progress ?? 5}%`);
          else if (soundState.blockers?.length) setBatchMessage(`${segmentLabel} · ${soundState.blockers.map((item) => `${item.name}：${item.reason}`).join("；")}`);
          else setBatchMessage(`${segmentLabel} · 后台执行器正在完成声音与片段归档`);
        }
        timer = window.setTimeout(() => setBatchTick((current) => current + 1), 1_600);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "分集批量生产状态读取失败");
          timer = window.setTimeout(() => setBatchTick((current) => current + 1), 3_000);
        }
      }
    };
    void observe();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [batchEpisodeId, batchTick, episodeBatch?.status, projectId]);

  const storyboardBlockers = useMemo(() => detail ? getStoryboardGenerationBlockers({
    episodeCount: detail.episodes.length,
    timelineJson: detail.storyBible?.timelineJson,
    assets: detail.assets,
    characterForms: detail.characterForms,
  }) : [], [detail]);
  const canGenerateStoryboards = Boolean(detail?.episodes.length) && !storyboardBlockers.length;

  const generateStoryboards = async () => {
    if (!projectId) return;
    if (storyboardBlockers.length) {
      setError(storyboardBlockers[0]);
      return;
    }
    const force = Boolean(detail?.shots.length);
    if (force && !window.confirm("重新生成会替换尚未进入生产的片段和分镜草案。已生成过媒体的分镜会受到保护，无法整套覆盖。确定继续吗？")) return;
    setGenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/storyboards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force }) });
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
  const selectedSegments = selectedEpisode ? detail?.segments.filter((segment) => segment.episodeId === selectedEpisode.id).sort((a, b) => a.sequence - b.sequence) ?? [] : [];
  const selectedEpisodeVideo = selectedEpisode ? detail?.assets.find((asset) => asset.id === selectedEpisode.videoAssetId) ?? null : null;
  const selectedEpisodeSubtitle = selectedEpisode ? detail?.assets.find((asset) => asset.id === selectedEpisode.subtitleAssetId) ?? null : null;
  const selectedEpisodeVersions = selectedEpisode ? detail?.episodeVersions.filter((version) => version.episodeId === selectedEpisode.id).sort((a, b) => b.versionNumber - a.versionNumber) ?? [] : [];
  const previewEpisodeVersion = selectedEpisodeVersions.find((version) => version.resultAssetId === previewEpisodeVersionAssetId) ?? null;
  const previewEpisodeVideo = previewEpisodeVersion ? detail?.assets.find((asset) => asset.id === previewEpisodeVersion.resultAssetId) ?? selectedEpisodeVideo : selectedEpisodeVideo;
  const previewEpisodeSubtitle = previewEpisodeVersion ? detail?.assets.find((asset) => asset.id === previewEpisodeVersion.subtitleAssetId) ?? null : selectedEpisodeSubtitle;
  const totalDuration = useMemo(() => detail?.shots.reduce((sum, shot) => sum + shot.durationMs, 0) ?? 0, [detail]);

  const openEpisodePreview = (episodeId: string) => {
    setPreviewEpisodeVersionAssetId(null);
    setQualityPendingSegmentIds([]);
    setPreviewEpisodeId(episodeId);
  };

  useEffect(() => {
    if (!projectId || !previewEpisodeId) return;
    let cancelled = false;
    let timer = 0;
    let observedActive = false;
    const poll = async () => {
      const response = await fetch(`/api/projects/${projectId}/episodes/${previewEpisodeId}/render`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const data = await response.json() as { activeJob?: { progress?: number } | null; lastFailure?: { message?: string | null } | null; qualityPendingSegments?: Array<{ id: string; sequence: number; title: string }> };
      const pendingQuality = data.qualityPendingSegments ?? [];
      setQualityPendingSegmentIds(pendingQuality.map((segmentItem) => segmentItem.id));
      if (data.activeJob) {
        observedActive = true;
        setRenderingEpisodeId(previewEpisodeId);
        setRenderStatus(`已恢复整集合成任务 · ${data.activeJob.progress ?? 5}%`);
        timer = window.setTimeout(poll, 1_600);
        return;
      }
      setRenderingEpisodeId((current) => current === previewEpisodeId ? null : current);
      if (data.lastFailure?.message) setRenderStatus(`上次整集合成失败：${data.lastFailure.message}`);
      else if (pendingQuality.length) setRenderStatus(`还有 ${pendingQuality.length} 个片段尚未由创作者确认，请进入片段工作台完成审片`);
      else if (observedActive) {
        setRenderStatus("整集合成已完成");
        const detailResponse = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (detailResponse.ok && !cancelled) setDetail(await detailResponse.json() as ProjectProductionDetail);
      } else setRenderStatus("");
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [previewEpisodeId, projectId, renderPollTick]);

  const renderEpisode = async () => {
    if (!projectId || !selectedEpisode || renderingEpisodeId) return;
    setRenderingEpisodeId(selectedEpisode.id);
    setRenderStatus("正在提交整集合成任务…");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subtitleStyle }) });
      const data = await response.json() as { error?: { message?: string }; message?: string };
      if (!response.ok) throw new Error(data.error?.message ?? "整集合成失败");
      setRenderStatus(data.message ?? "整集合成任务已提交，可关闭页面后继续查看");
      setRenderPollTick((current) => current + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "整集合成失败");
      setRenderingEpisodeId(null);
    }
  };

  const exportWholeProject = async () => {
    if (!projectId || exportingProject || projectExport?.activeJob) return;
    setExportingProject(true);
    setExportStatus("正在核对每集当前版本并生成整剧交付包…");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
      const data = await response.json() as { error?: { message?: string }; job?: { status?: string }; result?: ProjectExportResult; message?: string };
      if (!response.ok) throw new Error(data.error?.message ?? "整剧交付包生成失败");
      setExportStatus(data.result ? `整剧交付包已生成 · ${formatBytes(data.result.size ?? 0)}` : data.message ?? "整剧交付任务已提交，可关闭页面后继续查看");
      const statusResponse = await fetch(`/api/projects/${projectId}/export`, { cache: "no-store" });
      if (statusResponse.ok) setProjectExport(await statusResponse.json() as ProjectExportState);
    } catch (reason) {
      setExportStatus("");
      setError(reason instanceof Error ? reason.message : "整剧交付包生成失败");
    } finally {
      setExportingProject(false);
    }
  };

  if (!initialProject) {
    return <StudioShell view="videos" onNavigate={onNavigate}><div className="missing-project"><b>还没有选择短剧项目</b><p>请先打开项目并完成剧本与资产设置。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></StudioShell>;
  }

  return (
    <StudioShell view="videos" onNavigate={onNavigate}>
      <ProjectTop step={3} project={detail?.project ?? initialProject} onNavigate={onNavigate} title={detail?.project.title ?? initialProject.title} stylePreset={detail?.project.stylePreset ?? initialProject.stylePreset} aspectRatio={detail?.project.aspectRatio ?? initialProject.aspectRatio} saveState={detail?.shots.length ? "分镜脚本已保存" : "待生成分镜脚本"} />
      <div className="videos-page page-scroll">
        <div className="videos-heading"><div><p className="eyebrow">分集视频</p><h2>{detail?.episodes.length ?? 0} 集 · {detail?.segments.length ?? 0} 个片段 · {detail?.shots.length ?? 0} 个镜头</h2><p>每个片段组织多个镜头，并统一引用角色形象、场景声音场和对白计划。</p></div><div><AppButton onClick={() => void load()}>刷新</AppButton><AppButton primary disabled={generating || !canGenerateStoryboards} onClick={() => void generateStoryboards()}>{generating ? "正在拆分…" : detail?.shots.length ? "重新生成分镜脚本" : "生成分镜脚本"}</AppButton></div></div>
        {!loading && !detail?.shots.length && storyboardBlockers.length > 0 && <div className="storyboard-blocked-banner" role="alert"><b>还不能生成分镜脚本</b><ul>{storyboardBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul><AppButton onClick={() => storyboardBlockers.some((blocker) => blocker.includes("资产库")) ? onNavigate("assets") : storyboardBlockers.some((blocker) => blocker.includes("设置") || blocker.includes("LLM") || blocker.includes("视频")) ? openSettings(storyboardBlockers.some((blocker) => blocker.includes("路由") || blocker.includes("视频")) ? "routing" : "text") : onNavigate("script")}>{storyboardBlockers.some((blocker) => blocker.includes("资产库")) ? "返回资产库补图" : storyboardBlockers.some((blocker) => blocker.includes("设置") || blocker.includes("LLM") || blocker.includes("视频")) ? "打开设置" : "返回剧本大纲"}</AppButton></div>}
        {error && <p className="project-form-error asset-error videos-inline-error" role="alert">{error}</p>}
        {loading ? <div className="project-empty">正在读取分镜脚本…</div> : detail?.shots.length ? (
          <div className="episode-video-list">
            {detail.episodes.map((episode) => {
              const episodeShots = detail.shots.filter((shot) => shot.episodeId === episode.id);
              const episodeSegments = detail.segments.filter((segment) => segment.episodeId === episode.id);
              const duration = episodeShots.reduce((sum, shot) => sum + shot.durationMs, 0);
              const inheritedAudio = episodeShots.filter((shot) => shot.environmentPresetId).length;
              const readySegments = episodeSegments.filter((segment) => segment.videoAssetId).length;
              const isBatchEpisode = batchEpisodeId === episode.id && Boolean(episodeBatch);
              const batchRunning = isBatchEpisode && episodeBatch?.status === "running";
              const coverAssetId = episodeSegments.find((segment) => segment.videoAssetId)?.videoAssetId ?? episodeShots.find((shot) => shot.firstFrameAssetId)?.firstFrameAssetId ?? null;
              const coverUrl = detail.assets.find((asset) => asset.id === coverAssetId)?.thumbnailUrl ?? null;
              return (
                <article className="episode-video-card" key={episode.id}>
                  <button className={`episode-thumb storyboard-ready ${coverUrl ? "real-cover" : "missing-cover"}`} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined} onClick={() => openEpisodePreview(episode.id)}>{!coverUrl && <strong>尚无真实分镜画面</strong>}<span className="storyboard-count">{episodeSegments.length}<small>个片段</small></span><time>{formatDuration(duration)}</time></button>
                  <div className="episode-video-info"><div className="episode-state"><span>{episode.videoAssetId ? `✓ 整集成片版本 ${episode.currentVersionNumber}` : readySegments === episodeSegments.length && readySegments > 0 ? "✓ 本集片段视频已生成" : `片段视频 ${readySegments}/${episodeSegments.length}`}</span><small>{inheritedAudio}/{episodeShots.length} 个镜头继承场景声音场</small></div><p>第 {episode.episodeNumber} 集</p><h3>{episode.title}</h3><div className="episode-stats"><span>片段 {episodeSegments.length}</span><i /><span>角色 {detail.characters.length}</span><i /><span>场景 {detail.assets.filter((asset) => asset.assetType === "scene").length}</span><i /><span>镜头 {episodeShots.length}</span></div></div>
                  {isBatchEpisode && <div className={`episode-batch-state ${episodeBatch?.status ?? "idle"}`}><div><b>{episodeBatch?.status === "running" ? `正在批量生产 · ${episodeBatch.progress.ready}/${episodeBatch.progress.total}` : episodeBatch?.status === "failed" ? "批量生产已停在失败片段" : episodeBatch?.status === "complete" ? "本集片段已全部完成" : "批量生产已停止"}</b><span>{batchMessage || episodeBatch?.lastFailure?.message}</span></div><i><em style={{ width: `${episodeBatch?.batch?.progress ?? (episodeBatch?.status === "complete" ? 100 : Math.round((episodeBatch?.progress.ready ?? 0) / Math.max(1, episodeBatch?.progress.total ?? 1) * 100))}%` }} /></i>{batchRunning && <button onClick={() => void cancelEpisodeBatch()}>停止批次</button>}</div>}
                  <div className="episode-actions"><AppButton onClick={() => openEpisodePreview(episode.id)}>整集预览</AppButton>{episodeSegments.length > 0 && !episode.videoAssetId && <AppButton disabled={Boolean(episodeBatch?.status === "running" && batchEpisodeId !== episode.id) || batchRunning} onClick={() => void startEpisodeBatch(episode.id)}>{batchRunning ? `批量生产中 ${episodeBatch?.batch?.progress ?? 0}%` : isBatchEpisode && episodeBatch?.status === "failed" ? "从失败片段继续" : readySegments < episodeSegments.length ? "批量生成待完成片段" : "检查声音并完成片段"}</AppButton>}<AppButton primary onClick={() => onOpenEditor(episode.id)}>进入片段生产</AppButton></div>
                </article>
              );
            })}
          </div>
        ) : <div className="asset-empty-state"><div>镜</div><h3>还没有片段和镜头计划</h3><p>确认项目级角色、场景和道具后，小飞象会把分集剧本拆成片段，并在每个片段内组织多个镜头；声音能力仅在生成方案需要时使用。</p><AppButton primary disabled={generating || !canGenerateStoryboards} onClick={() => void generateStoryboards()}>生成分镜脚本</AppButton></div>}
        {detail?.episodes.length ? <section className="project-delivery-card"><div className="project-delivery-summary"><div><p className="eyebrow">整剧交付</p><h3>一次交付当前全部分集版本</h3><p>交付包包含每集当前成片、对应 SRT 字幕，以及记录版本号、文件大小和 SHA-256 校验值的清单。</p></div><div className="project-delivery-count"><b>{projectExport?.readyEpisodeCount ?? detail.episodes.filter((episode) => episode.videoAssetId).length}/{projectExport?.episodeCount ?? detail.episodes.length}</b><span>分集成片已就绪</span></div></div>{projectExport?.missingEpisodes.length ? <div className="project-delivery-blocked"><b>还不能导出整部短剧</b><span>缺少：{projectExport.missingEpisodes.map((episode) => `第 ${episode.episodeNumber} 集`).join("、")}</span></div> : null}{exportStatus && <p className="project-delivery-status" aria-live="polite">{exportStatus}</p>}<div className="project-delivery-actions"><AppButton primary disabled={exportingProject || Boolean(projectExport?.activeJob) || projectExport?.readiness !== "ready"} onClick={() => void exportWholeProject()}>{exportingProject ? "正在打包真实成片…" : projectExport?.activeJob ? `正在生成 ${projectExport.activeJob.progress}%` : "导出整部短剧"}</AppButton>{projectExport?.records.find((record) => record.status === "succeeded" && record.result?.url)?.result?.url && <a className="app-button" href={projectExport.records.find((record) => record.status === "succeeded" && record.result?.url)!.result!.url} download>下载最近交付包</a>}</div>{projectExport?.records.length ? <div className="project-delivery-history"><b>交付记录</b>{projectExport.records.slice(0, 5).map((record) => <div key={record.id}><i className={record.status}>{record.status === "succeeded" ? "✓" : record.status === "failed" ? "!" : "…"}</i><span>{record.status === "succeeded" ? record.result?.name ?? "整剧交付包" : record.status === "failed" ? record.errorMessage ?? "导出失败" : `正在生成 · ${record.progress}%`}</span><time>{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>{record.status === "succeeded" && record.result?.url && <a href={record.result.url} download>{formatBytes(record.result.size ?? 0)} · 下载</a>}</div>)}</div> : null}</section> : null}
        <div className="videos-footer"><AppButton onClick={() => onNavigate("assets")}>← 上一步</AppButton><div><span><i className="status-dot" />分镜预计总时长 {formatDuration(totalDuration)}</span><AppButton primary disabled={!detail?.shots.length} onClick={() => detail?.episodes[0] && openEpisodePreview(detail.episodes[0].id)}>检查全部分镜 →</AppButton></div></div>
      </div>
      {selectedEpisode && <div className="modal-backdrop" onMouseDown={() => setPreviewEpisodeId(null)}><div className="episode-render-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">第 {selectedEpisode.episodeNumber} 集 · {formatDuration(selectedShots.reduce((sum, shot) => sum + shot.durationMs, 0))}</p><h2>{selectedEpisode.title}</h2></div><button onClick={() => setPreviewEpisodeId(null)}>×</button></div>{previewEpisodeVideo?.thumbnailUrl ? <div className="episode-final-preview"><video controls src={previewEpisodeVideo.thumbnailUrl} /><span>整集成片 · 版本 {previewEpisodeVersion?.versionNumber ?? selectedEpisode.currentVersionNumber}</span>{selectedEpisodeVersions.length > 1 && <label className="episode-version-picker">历史版本<select value={previewEpisodeVersionAssetId ?? selectedEpisode.videoAssetId ?? ""} onChange={(event) => setPreviewEpisodeVersionAssetId(event.target.value)}>{selectedEpisodeVersions.map((version) => <option key={version.id} value={version.resultAssetId ?? ""}>版本 {version.versionNumber}{version.versionNumber === selectedEpisode.currentVersionNumber ? " · 当前" : ""}</option>)}</select></label>}</div> : <div className="episode-render-empty"><b>整集成片尚未合成</b><p>所有片段生成并由你确认后，小飞象会合成整集视频，把对白字幕直接烧录到成片中，同时保留可下载 SRT。AI 连续性质检为可选辅助。</p></div>}{renderStatus && <p className="episode-render-status" aria-live="polite">{renderStatus}</p>}<div className="episode-segment-timeline">{selectedSegments.map((segmentItem) => { const asset = detail?.assets.find((item) => item.id === segmentItem.videoAssetId); const qualityPending = qualityPendingSegmentIds.includes(segmentItem.id); return <article key={segmentItem.id}><div>{asset?.thumbnailUrl ? <video controls preload="metadata" src={asset.thumbnailUrl} /> : <span>待生成</span>}</div><p><b>片段 {String(segmentItem.sequence).padStart(2, "0")}</b><span>{segmentItem.title}</span><small>{formatDuration(segmentItem.durationMs)} · {segmentItem.currentVersionNumber > 0 ? `V${segmentItem.currentVersionNumber} · ` : ""}{segmentItem.videoAssetId ? qualityPending ? "待创作者确认" : segmentItem.status : "尚无视频"}</small></p></article>; })}</div>{error && <p className="project-form-error episode-render-error">{error}</p>}<div className="modal-footer episode-render-actions"><AppButton onClick={() => setPreviewEpisodeId(null)}>关闭</AppButton><div>{qualityPendingSegmentIds.length > 0 && <AppButton onClick={() => onOpenEditor(selectedEpisode.id)}>去完成片段审片</AppButton>}<label className="subtitle-style-picker">成片字幕<select value={subtitleStyle} disabled={renderingEpisodeId === selectedEpisode.id} onChange={(event) => setSubtitleStyle(event.target.value as typeof subtitleStyle)}><option value="short_drama">短剧醒目</option><option value="cinematic">电影简洁</option><option value="minimal">极简细字</option></select></label>{previewEpisodeSubtitle?.thumbnailUrl && <a className="app-button" href={previewEpisodeSubtitle.thumbnailUrl} download>下载当前版本字幕</a>}{previewEpisodeVideo?.thumbnailUrl && <a className="app-button" href={previewEpisodeVideo.thumbnailUrl} download>下载当前版本成片</a>}<AppButton primary disabled={renderingEpisodeId === selectedEpisode.id || qualityPendingSegmentIds.length > 0 || !selectedSegments.length || selectedSegments.some((item) => !item.videoAssetId)} onClick={() => void renderEpisode()}>{renderingEpisodeId === selectedEpisode.id ? "FFmpeg 正在合成并烧录字幕…" : qualityPendingSegmentIds.length ? `还需确认 ${qualityPendingSegmentIds.length} 个片段` : selectedEpisode.videoAssetId ? `重新合成版本 ${selectedEpisode.currentVersionNumber + 1}` : selectedSegments.some((item) => !item.videoAssetId) ? "请先完成全部片段" : "合成整集并导出"}</AppButton></div></div></div></div>}
    </StudioShell>
  );
}
