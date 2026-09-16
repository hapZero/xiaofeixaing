"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { useSettings } from "../settings/SettingsProvider";
import { AppButton } from "../../components/ui";
import { describeGenerationError } from "../../lib/generation-errors";
import { visualAssetApproved } from "../../lib/visual-asset-approval";
import { CanvasOverlay } from "../canvas/CanvasWorkspace";
import { ProjectTop } from "../project/ProjectTop";
import { CharacterDetailModal } from "./CharacterDetailModal";
import type { AudioPreset, CharacterForm, CharacterFormReference, ProjectAsset, ProjectCharacter, ProjectEpisode, ProjectGenerationJob, ProjectSummary, View } from "../studio/types";

type AssetTab = "角色" | "场景" | "道具" | "素材";
type AssetFilter = "all" | "pending" | "review" | "locked";
type VisualAssetState = Exclude<AssetFilter, "all">;
type ProjectAssetsResponse = {
  project: ProjectSummary;
  episodes: ProjectEpisode[];
  assets: ProjectAsset[];
  characters: ProjectCharacter[];
  characterForms: CharacterForm[];
  characterFormReferences: CharacterFormReference[];
  audioPresets: AudioPreset[];
  generationJobs?: ProjectGenerationJob[];
};
type VisualAssetBatchState = {
  status: "idle" | "running" | "failed" | "cancelled" | "complete";
  batch: { id: string; progress: number; currentIndex: number; total: number } | null;
  progress: { generated: number; total: number; remaining: number };
  currentItem: { key: string; title: string; capability: string } | null;
  lastFailure: { code: string | null; message: string | null; item?: { title?: string } | null } | null;
};

function sceneAssetId(preset: AudioPreset): string | null {
  try {
    const config = JSON.parse(preset.configJson) as { sceneAssetId?: unknown };
    return typeof config.sceneAssetId === "string" ? config.sceneAssetId : null;
  } catch {
    return null;
  }
}

function assetDescription(asset: ProjectAsset): string {
  try {
    const metadata = JSON.parse(asset.metadataJson) as { description?: unknown };
    return typeof metadata.description === "string" && metadata.description.trim() ? metadata.description : "根据剧本设定生成稳定、可复用的视觉标准图";
  } catch {
    return "根据剧本设定生成稳定、可复用的视觉标准图";
  }
}

function assetMediaType(asset: ProjectAsset): "image" | "video" | "audio" | "text" | "file" {
  try {
    const mediaType = (JSON.parse(asset.metadataJson) as { mediaType?: unknown }).mediaType;
    if (mediaType === "image" || mediaType === "video" || mediaType === "audio" || mediaType === "text") return mediaType;
  } catch {
    // Fall back to the persisted asset type for older records.
  }
  if (asset.assetType.includes("video")) return "video";
  if (asset.assetType.includes("audio") || asset.assetType.includes("voice")) return "audio";
  if (asset.assetType.includes("subtitle") || asset.assetType.includes("script")) return "text";
  if (asset.assetType === "project_export" || asset.name.toLowerCase().endsWith(".zip")) return "file";
  return "image";
}

function formHasReadyAsset(form: CharacterForm, assets: ProjectAsset[], formReferences: CharacterFormReference[] = []): boolean {
  if (!formHasGeneratedAsset(form, assets, formReferences)) return false;
  return Boolean(form.assetId && assets.some((asset) => asset.id === form.assetId && asset.thumbnailUrl && asset.status === "ready" && visualAssetApproved(asset.metadataJson)));
}

function formHasGeneratedAsset(form: CharacterForm, assets: ProjectAsset[], formReferences: CharacterFormReference[] = []): boolean {
  const packReady = formReferences.some((reference) => reference.characterFormId === form.id && assets.some((asset) => asset.id === reference.assetId && asset.storageKey && asset.thumbnailUrl && asset.status === "ready"));
  if (packReady) return true;
  // 无参考图包时，仅有概念图不算形态已生成
  return false;
}

function visualAssetGenerated(asset: ProjectAsset | null | undefined): boolean {
  return Boolean(asset?.storageKey && asset.thumbnailUrl && asset.status === "ready");
}

function visualAssetReady(asset: ProjectAsset | null | undefined): boolean {
  return Boolean(asset?.thumbnailUrl && asset.status === "ready" && visualAssetApproved(asset.metadataJson));
}

function visualAssetState(asset: ProjectAsset | null | undefined): VisualAssetState {
  if (visualAssetReady(asset)) return "locked";
  if (visualAssetGenerated(asset)) return "review";
  return "pending";
}

function characterFormState(form: CharacterForm, assets: ProjectAsset[], formReferences: CharacterFormReference[] = []): VisualAssetState {
  if (!formHasGeneratedAsset(form, assets, formReferences)) return "pending";
  return visualAssetState(form.assetId ? assets.find((asset) => asset.id === form.assetId) : null);
}

const ACTIVE_GENERATION_STATUSES = ["submitting", "queued", "running"] as const;

function findActiveGenerationJob(
  jobs: ProjectGenerationJob[] | undefined,
  filter: { entityType: string; entityId: string; capabilities?: readonly string[] },
) {
  return jobs?.find((job) =>
    job.entityType === filter.entityType
    && job.entityId === filter.entityId
    && (!filter.capabilities || filter.capabilities.includes(job.capability))
    && ACTIVE_GENERATION_STATUSES.includes(job.status as (typeof ACTIVE_GENERATION_STATUSES)[number]),
  ) ?? null;
}

export function AssetsPage({ onNavigate, project: initialProject }: { onNavigate: (view: View) => void; project: ProjectSummary | null }) {
  const { openSettings } = useSettings();
  const [tab, setTab] = useState<AssetTab>("角色");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [detail, setDetail] = useState<ProjectAssetsResponse | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<ProjectCharacter | null>(null);
  const [selectedVisualAsset, setSelectedVisualAsset] = useState<ProjectAsset | null>(null);
  const [selectedEnvironmentAsset, setSelectedEnvironmentAsset] = useState<ProjectAsset | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<ProjectAsset | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialProject));
  const [extracting, setExtracting] = useState(false);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [preparingShots, setPreparingShots] = useState(false);
  const [lockingAll, setLockingAll] = useState(false);
  const [visualBatch, setVisualBatch] = useState<VisualAssetBatchState | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchConfigurationMissing, setBatchConfigurationMissing] = useState(false);
  const [error, setError] = useState("");

  const projectId = initialProject?.id ?? null;
  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [response, batchResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/assets/produce`, { cache: "no-store" }),
      ]);
      if (!response.ok || !batchResponse.ok) throw new Error("项目资产加载失败");
      const [data, batch] = await Promise.all([response.json() as Promise<ProjectAssetsResponse>, batchResponse.json() as Promise<VisualAssetBatchState>]);
      setDetail(data);
      setVisualBatch(batch);
      const activeAnalysis = data.generationJobs?.find((job) => job.capability === "llm_analysis" && ["queued", "running"].includes(job.status));
      setAnalysisJobId(activeAnalysis?.id ?? null);
      setExtracting(Boolean(activeAnalysis));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目资产加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([fetch(`/api/projects/${projectId}`, { cache: "no-store" }), fetch(`/api/projects/${projectId}/assets/produce`, { cache: "no-store" })])
      .then(async ([response, batchResponse]) => {
        if (!response.ok || !batchResponse.ok) throw new Error("项目资产加载失败");
        return { data: await response.json() as ProjectAssetsResponse, batch: await batchResponse.json() as VisualAssetBatchState };
      })
      .then(({ data, batch }) => {
        if (cancelled) return;
        setDetail(data);
        setVisualBatch(batch);
        const activeAnalysis = data.generationJobs?.find((job) => job.capability === "llm_analysis" && ["queued", "running"].includes(job.status));
        setAnalysisJobId(activeAnalysis?.id ?? null);
        setExtracting(Boolean(activeAnalysis));
        const failedAnalysis = data.generationJobs?.find((job) => job.capability === "llm_analysis" && job.status === "failed");
        if (failedAnalysis && data.project.status === "script_analysis_failed") setError(failedAnalysis.errorMessage || "资产提取失败，可安全重新提取");
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "项目资产加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!analysisJobId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/generation/jobs/${analysisJobId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("资产提取任务状态读取失败");
        const data = await response.json() as { job?: ProjectGenerationJob };
        if (cancelled || !data.job) return;
        if (["queued", "running"].includes(data.job.status)) {
          timer = window.setTimeout(poll, 1_500);
          return;
        }
        setAnalysisJobId(null);
        setExtracting(false);
        if (data.job.status === "failed") setError(data.job.errorMessage || "资产提取失败，原始剧本已保留，可安全重试");
        await load();
      } catch (reason) {
        if (cancelled) return;
        setAnalysisJobId(null);
        setExtracting(false);
        setError(reason instanceof Error ? reason.message : "资产提取任务状态读取失败");
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [analysisJobId]);

  useEffect(() => {
    if (!detail) return;
    if (selectedVisualAsset) {
      const latest = detail.assets.find((item) => item.id === selectedVisualAsset.id);
      if (latest && (latest.thumbnailUrl !== selectedVisualAsset.thumbnailUrl || latest.metadataJson !== selectedVisualAsset.metadataJson || latest.status !== selectedVisualAsset.status)) {
        setSelectedVisualAsset(latest);
      }
    }
    if (selectedCharacter) {
      const latest = detail.characters.find((item) => item.id === selectedCharacter.id);
      if (latest && (latest.assetId !== selectedCharacter.assetId || latest.voiceLocked !== selectedCharacter.voiceLocked)) {
        setSelectedCharacter(latest);
      }
    }
  }, [detail, selectedCharacter, selectedVisualAsset]);

  useEffect(() => {
    if (!projectId || visualBatch?.status !== "running") return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/assets/produce`, { cache: "no-store" });
        if (!response.ok) throw new Error("批量生成状态读取失败");
        const batch = await response.json() as VisualAssetBatchState;
        if (cancelled) return;
        setVisualBatch(batch);
        if (batch.status === "running") timer = window.setTimeout(poll, 1_800);
        else {
          if (batch.status === "failed") setError(batch.lastFailure?.message || "视觉资产批量生成失败");
          await load();
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "批量生成状态读取失败");
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, visualBatch?.status]);

  const characterAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "character") ?? [], [detail]);
  const sceneAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "scene") ?? [], [detail]);
  const propAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "prop") ?? [], [detail]);
  const materialAssets = useMemo(() => detail?.assets.filter((asset) => !["character", "scene", "prop"].includes(asset.assetType)) ?? [], [detail]);
  const counts: Record<AssetTab, number> = { 角色: detail?.characters.length ?? 0, 场景: sceneAssets.length, 道具: propAssets.length, 素材: materialAssets.length };
  const configured = (detail?.characters.filter((character) => character.voiceLocked).length ?? 0) + (detail?.audioPresets.filter((preset) => preset.locked).length ?? 0);
  const configurable = (detail?.characters.length ?? 0) + (detail?.audioPresets.length ?? 0);
  const readyCharacterForms = detail?.characterForms.filter((form) => formHasReadyAsset(form, detail.assets, detail.characterFormReferences)).length ?? 0;
  const generatedCharacterForms = detail?.characterForms.filter((form) => formHasGeneratedAsset(form, detail.assets, detail.characterFormReferences)).length ?? 0;
  const characterFormTotal = detail?.characterForms.length ?? 0;
  const readyVisualAssets = readyCharacterForms + sceneAssets.filter(visualAssetReady).length + propAssets.filter(visualAssetReady).length;
  const generatedVisualAssets = generatedCharacterForms + sceneAssets.filter(visualAssetGenerated).length + propAssets.filter(visualAssetGenerated).length;
  const visualAssetTotal = characterFormTotal + sceneAssets.length + propAssets.length;
  const reviewVisualAssets = generatedVisualAssets - readyVisualAssets;
  const projectForNavigation = detail?.assets.length
    ? { ...(detail.project ?? initialProject!), status: "assets" }
    : detail?.project ?? initialProject;
  const pendingVisualAssets = visualAssetTotal - generatedVisualAssets;
  const currentTabVisualStates = tab === "角色"
    ? detail?.characterForms.map((form) => characterFormState(form, detail.assets, detail.characterFormReferences)) ?? []
    : tab === "场景" ? sceneAssets.map(visualAssetState)
      : tab === "道具" ? propAssets.map(visualAssetState) : [];
  const currentTabStateCounts = {
    pending: currentTabVisualStates.filter((state) => state === "pending").length,
    review: currentTabVisualStates.filter((state) => state === "review").length,
    locked: currentTabVisualStates.filter((state) => state === "locked").length,
  };
  const visibleCharacters = detail?.characters.filter((character) => {
    if (assetFilter === "all") return true;
    const forms = detail.characterForms.filter((form) => form.characterId === character.id);
    return forms.some((form) => characterFormState(form, detail.assets, detail.characterFormReferences) === assetFilter);
  }) ?? [];
  const visibleScenes = sceneAssets.filter((asset) => {
    if (assetFilter === "all") return true;
    return visualAssetState(asset) === assetFilter;
  });
  const visibleProps = propAssets.filter((asset) => assetFilter === "all" || visualAssetState(asset) === assetFilter);

  const extractAgain = async () => {
    if (!projectId) return;
    setExtracting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/extract-assets`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "资产提取失败");
      }
      const data = await response.json() as { job?: ProjectGenerationJob };
      if (!data.job) throw new Error("资产提取任务未能建立");
      setAnalysisJobId(data.job.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产提取失败");
      setExtracting(false);
    }
  };

  const startVisualAssetBatch = async () => {
    if (!projectId || batchSubmitting) return;
    setBatchSubmitting(true);
    setBatchConfigurationMissing(false);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/produce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      const data = await response.json() as VisualAssetBatchState & { error?: { code?: string; message?: string } };
      if (!response.ok) {
        if (data.error?.code === "VISUAL_ASSET_WORKFLOWS_REQUIRED") setBatchConfigurationMissing(true);
        throw new Error(data.error?.message ?? "视觉资产批量生成启动失败");
      }
      setVisualBatch(data);
      if (data.status !== "running") {
        if ((data.progress?.remaining ?? 0) > 0) {
          setError("有待完成资产，但服务端没有可入队的任务。请点刷新后重试。");
        } else {
          await load();
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视觉资产批量生成启动失败");
    } finally {
      setBatchSubmitting(false);
    }
  };

  const cancelVisualAssetBatch = async () => {
    if (!projectId || batchSubmitting) return;
    setBatchSubmitting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/produce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const data = await response.json() as VisualAssetBatchState & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "停止批量生成失败");
      setVisualBatch(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "停止批量生成失败");
    } finally {
      setBatchSubmitting(false);
    }
  };

  const confirmAssets = async () => {
    if (!projectId) return;
    setPreparingShots(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/storyboards`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "分镜脚本生成失败");
      }
      onNavigate("videos");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜脚本生成失败");
    } finally {
      setPreparingShots(false);
    }
  };

  const lockAllGeneratedAssets = async () => {
    if (!projectId || lockingAll) return;
    setLockingAll(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/approve`, { method: "POST" });
      const data = await response.json() as { locked?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "批量确认失败");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量确认失败");
    } finally {
      setLockingAll(false);
    }
  };

  if (!initialProject) {
    return <StudioShell view="assets" onNavigate={onNavigate}><div className="missing-project"><b>还没有选择短剧项目</b><p>请先打开项目并确认剧本。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></StudioShell>;
  }

  return (
    <StudioShell view="assets" onNavigate={onNavigate}>
      <ProjectTop step={2} project={projectForNavigation} onNavigate={onNavigate} title={detail?.project.title ?? initialProject.title} stylePreset={detail?.project.stylePreset ?? initialProject.stylePreset} aspectRatio={detail?.project.aspectRatio ?? initialProject.aspectRatio} saveState="项目级资产" />
      <div className="assets-page">
        <div className="assets-heading">
          <div><p className="eyebrow">全剧资产</p><h2>确认角色形态、场景与道具</h2><p>视觉资产供全剧片段复用；角色音色和场景声音是可选增强，只在所选视频路线需要时使用。</p></div>
          <div className="assets-heading-actions"><AppButton onClick={extractAgain} disabled={extracting}>{extracting ? "正在提取…" : "重新提取资产"}</AppButton>{batchConfigurationMissing ? <AppButton primary onClick={() => openSettings("image", "character_image")}>打开设置 · 图片能力</AppButton> : visualAssetTotal > generatedVisualAssets ? <AppButton primary disabled={batchSubmitting || visualBatch?.status === "running"} onClick={() => void startVisualAssetBatch()}>{visualBatch?.status === "running" ? `批量生成中 ${visualBatch.batch?.progress ?? 0}%` : batchSubmitting ? "正在启动…" : `批量生成待完成资产 ${visualAssetTotal - generatedVisualAssets}`}</AppButton> : null}<AppButton onClick={() => setCanvasOpen(true)}>⌘ 去画布编辑</AppButton></div>
        </div>
        {visualBatch?.status === "running" && <div className="visual-asset-batch-state" aria-live="polite"><div><b>正在批量生成项目视觉资产</b><span>{visualBatch.currentItem?.title ?? "正在准备下一个资产"} · 已生成 {visualBatch.progress.generated}/{visualBatch.progress.total}</span></div><i><em style={{ width: `${Math.max(2, visualBatch.batch?.progress ?? 0)}%` }} /></i><button type="button" disabled={batchSubmitting} onClick={() => void cancelVisualAssetBatch()}>停止批次</button></div>}
        {visualBatch?.status === "failed" && visualBatch.lastFailure?.message && <div className="visual-asset-batch-state failed"><div><b>批量生成已停在失败资产</b><span>{visualBatch.lastFailure.message}</span></div><button type="button" disabled={batchSubmitting} onClick={() => void startVisualAssetBatch()}>从未完成资产继续</button></div>}
        {error && <p className="project-form-error asset-error" role="alert">{error}</p>}
        <div className="asset-tabs">
          {(["角色", "场景", "道具", "素材"] as AssetTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<span>{counts[item]}</span></button>)}
        </div>
        <div className="asset-toolbar"><div>{tab !== "素材" && <><button className={assetFilter === "all" ? "active" : ""} onClick={() => setAssetFilter("all")}>全部 {currentTabVisualStates.length}</button><button className={assetFilter === "pending" ? "active" : ""} onClick={() => setAssetFilter("pending")}>待生成 {currentTabStateCounts.pending}</button><button className={assetFilter === "review" ? "active" : ""} onClick={() => setAssetFilter("review")}>待确认 {currentTabStateCounts.review}</button><button className={assetFilter === "locked" ? "active" : ""} onClick={() => setAssetFilter("locked")}>已锁定 {currentTabStateCounts.locked}</button></>}</div><div><button onClick={() => void load()}>↻ 刷新</button></div></div>
        {loading ? <div className="project-empty">正在读取项目资产…</div> : (
          <>
            {tab === "角色" && (detail?.characters.length ? <div className="asset-grid role-grid">
              {visibleCharacters.map((character, index) => {
                const linkedAsset = characterAssets.find((asset) => asset.id === character.assetId);
                const forms = detail.characterForms.filter((form) => form.characterId === character.id);
                const formStates = forms.map((form) => characterFormState(form, detail.assets, detail.characterFormReferences));
                const generatedForms = formStates.filter((state) => state !== "pending").length;
                const reviewForms = formStates.filter((state) => state === "review").length;
                const lockedForms = formStates.filter((state) => state === "locked").length;
                return (
                  <button className="asset-card" key={character.id} onClick={() => setSelectedCharacter(character)}>
                    <div className={`asset-image portrait ${linkedAsset?.thumbnailUrl ? "has-real-asset" : "missing-real-asset"}`} style={linkedAsset?.thumbnailUrl ? { backgroundImage: `url(${linkedAsset.thumbnailUrl})` } : undefined}>
                      <span className={forms.length > 0 && lockedForms === forms.length ? "confirmed" : "review"}>{forms.length > 0 && lockedForms === forms.length ? "形态已锁定" : reviewForms ? `${reviewForms} 个形态待确认` : "形态待生成"}</span>
                      {!linkedAsset?.thumbnailUrl && <strong className="asset-missing-label">尚未生成角色标准图</strong>}
                      {index === 0 && <em>主角</em>}<i className="voice-badge">♬</i>
                    </div>
                    <div className="asset-card-info"><div><h3>{character.canonicalName}<small>已生成 {generatedForms}/{forms.length} · 已锁定 {lockedForms}/{forms.length}</small></h3><p>{linkedAsset?.thumbnailUrl ? `视觉结果已归档 · ${character.voiceLocked ? "音色已锁定" : "音色可选配置"}` : "点击生成角色形态标准图"}</p></div><b>···</b></div>
                  </button>
                );
              })}
              {!visibleCharacters.length && <AssetEmpty title="当前筛选没有角色" description="切换“全部”查看其他角色。" />}
            </div> : <AssetEmpty title="没有识别到角色" description="请在剧本中使用“人物：角色甲、角色乙”或角色对白格式，再重新提取。" onExtract={extractAgain} />)}
            {tab === "场景" && (sceneAssets.length ? <div className="asset-grid scene-grid">
              {visibleScenes.map((asset) => {
                const preset = detail?.audioPresets.find((item) => sceneAssetId(item) === asset.id) ?? null;
                const approved = visualAssetReady(asset);
                return <article className="asset-card scene-asset-card" key={asset.id}><button className="scene-visual-action" onClick={() => setSelectedVisualAsset(asset)}><div className={`asset-image landscape ${asset.thumbnailUrl ? "has-real-asset" : "missing-real-asset"}`} style={asset.thumbnailUrl ? { backgroundImage: `url(${asset.thumbnailUrl})` } : undefined}><span className={approved ? "confirmed" : "review"}>{approved ? "视觉已锁定" : asset.thumbnailUrl ? "待确认" : "待生成"}</span>{!asset.thumbnailUrl && <strong className="asset-missing-label">尚未生成场景标准图</strong>}</div><div className="asset-card-info"><div><h3>{asset.name}</h3><p>{assetDescription(asset)}</p>{preset?.locked && <small>环境声音场已锁定</small>}</div><b>编辑视觉</b></div></button><button className={preset?.locked ? "scene-sound-action configured" : "scene-sound-action"} onClick={() => setSelectedEnvironmentAsset(asset)}>≈ {preset?.locked ? "编辑声音场" : "配置声音场（可选）"}</button></article>;
              })}
              {!visibleScenes.length && <AssetEmpty title="当前筛选没有场景" description="切换“全部”查看其他场景。" />}
            </div> : <AssetEmpty title="没有识别到场景" description="请在剧本中使用“场景：旧教室”或“旧教室 · 日 · 内”的格式，再重新提取。" onExtract={extractAgain} />)}
            {tab === "道具" && (propAssets.length ? <div className="asset-grid scene-grid">{visibleProps.map((asset) => { const approved = visualAssetReady(asset); return <button className="asset-card" key={asset.id} onClick={() => setSelectedVisualAsset(asset)}><div className={`asset-image landscape prop-image ${asset.thumbnailUrl ? "has-real-asset" : "missing-real-asset"}`} style={asset.thumbnailUrl ? { backgroundImage: `url(${asset.thumbnailUrl})` } : undefined}><span className={approved ? "confirmed" : "review"}>{approved ? "视觉已锁定" : asset.thumbnailUrl ? "待确认" : "待生成"}</span>{!asset.thumbnailUrl && <strong className="asset-missing-label">尚未生成道具标准图</strong>}</div><div className="asset-card-info"><div><h3>{asset.name}</h3><p>{assetDescription(asset)}</p></div><b>···</b></div></button>; })}{!visibleProps.length && <AssetEmpty title="当前筛选没有道具" description="切换“全部”查看其他道具。" />}</div> : <AssetEmpty title="没有识别到关键道具" description="文本智能会从完整剧本识别影响剧情或连续性的关键道具。" onExtract={extractAgain} />)}
            {tab === "素材" && (materialAssets.length ? <div className="asset-grid material-grid">
              {materialAssets.map((asset) => {
                const mediaType = assetMediaType(asset);
                return <button className="asset-card material-card" key={asset.id} onClick={() => setSelectedMaterial(asset)}><div className={`asset-image landscape material-preview ${mediaType !== "image" || !asset.thumbnailUrl ? "material-placeholder" : "has-real-asset"}`} style={mediaType === "image" && asset.thumbnailUrl ? { backgroundImage: `url(${asset.thumbnailUrl})` } : undefined}><strong>{mediaType === "video" ? "▶" : mediaType === "audio" ? "♬" : mediaType === "text" ? "TXT" : mediaType === "file" ? "ZIP" : "◇"}</strong><span className={asset.status === "ready" ? "confirmed" : "review"}>{asset.status === "ready" ? "已归档" : asset.status}</span></div><div className="asset-card-info"><div><h3>{asset.name}</h3><p>{mediaType === "video" ? "视频" : mediaType === "audio" ? "音频" : mediaType === "text" ? "字幕/文本" : mediaType === "file" ? "整剧交付包" : "图片"}{asset.episodeId ? " · 分集素材" : " · 项目素材"}</p></div><b>{mediaType === "file" ? "下载" : "预览"}</b></div></button>;
              })}
            </div> : <AssetEmpty title="还没有项目素材" description="后续上传或生成的图片、视频、音频和字幕会统一保存在这里。" />)}
          </>
        )}
        <div className="asset-page-footer"><AppButton onClick={() => onNavigate("script")}>← 上一步</AppButton><div>{error && <p className="project-form-error asset-error footer-inline-error" role="alert">{error}</p>}<span>{visualAssetTotal ? `待生成 ${pendingVisualAssets} · 已出图 ${generatedVisualAssets}/${visualAssetTotal} · 可选声音 ${configured}/${configurable}` : "请先从剧本提取角色、场景和道具"}</span>{reviewVisualAssets > 0 && generatedVisualAssets >= visualAssetTotal && <AppButton disabled={lockingAll || preparingShots} onClick={() => void lockAllGeneratedAssets()}>{lockingAll ? "正在确认…" : `一键确认 ${reviewVisualAssets} 项已出图资产`}</AppButton>}<AppButton primary disabled={!detail || !visualAssetTotal || generatedVisualAssets < visualAssetTotal || preparingShots || lockingAll} onClick={() => void confirmAssets()}>{preparingShots ? "正在建立片段与分镜…" : generatedVisualAssets >= visualAssetTotal ? "确认全部并排分镜 →" : `还需生成 ${pendingVisualAssets} 项视觉资产`}</AppButton></div></div>
      </div>
      {selectedCharacter && projectId && <CharacterDetailModal projectId={projectId} project={detail?.project ?? initialProject!} character={selectedCharacter} forms={detail?.characterForms.filter((form) => form.characterId === selectedCharacter.id) ?? []} formReferences={detail?.characterFormReferences.filter((reference) => detail.characterForms.some((form) => form.characterId === selectedCharacter.id && form.id === reference.characterFormId)) ?? []} allAssets={detail?.assets ?? []} onGenerated={() => void load()} onClose={() => setSelectedCharacter(null)} onSaved={(character) => { setDetail((current) => current ? { ...current, characters: current.characters.map((item) => item.id === character.id ? character : item) } : current); setSelectedCharacter(character); }} />}
      {selectedVisualAsset && projectId && <VisualAssetModal projectId={projectId} project={detail?.project ?? initialProject} asset={selectedVisualAsset} onGenerated={() => void load()} onClose={() => setSelectedVisualAsset(null)} />}
      {selectedEnvironmentAsset && projectId && <EnvironmentModal projectId={projectId} sceneAsset={selectedEnvironmentAsset} preset={detail?.audioPresets.find((item) => sceneAssetId(item) === selectedEnvironmentAsset.id) ?? null} onClose={() => setSelectedEnvironmentAsset(null)} onSaved={(preset) => { setDetail((current) => current ? { ...current, audioPresets: current.audioPresets.some((item) => item.id === preset.id) ? current.audioPresets.map((item) => item.id === preset.id ? preset : item) : [...current.audioPresets, preset] } : current); setSelectedEnvironmentAsset(null); }} />}
      {selectedMaterial && <MaterialPreviewModal asset={selectedMaterial} onClose={() => setSelectedMaterial(null)} />}
      {canvasOpen && <CanvasOverlay projectId={projectId} title={initialProject.title} onClose={() => setCanvasOpen(false)} onContinue={() => { setCanvasOpen(false); void confirmAssets(); }} />}
    </StudioShell>
  );
}

function AssetEmpty({ title, description, onExtract }: { title: string; description: string; onExtract?: () => void }) {
  return <div className="asset-empty-state"><div>◇</div><h3>{title}</h3><p>{description}</p>{onExtract && <AppButton onClick={onExtract}>重新提取资产</AppButton>}</div>;
}

function MaterialPreviewModal({ asset, onClose }: { asset: ProjectAsset; onClose: () => void }) {
  const mediaType = assetMediaType(asset);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="material-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">真实项目素材</p><h2>{asset.name}</h2></div><button onClick={onClose}>×</button></div>
    <div className="material-preview-body">{asset.thumbnailUrl ? mediaType === "video" ? <video controls preload="metadata" src={asset.thumbnailUrl} /> : mediaType === "audio" ? <div className="material-audio-player"><span>♬</span><audio controls preload="metadata" src={asset.thumbnailUrl} /></div> : mediaType === "image" ? <div className="material-image-full" style={{ backgroundImage: `url(${asset.thumbnailUrl})` }} /> : mediaType === "file" ? <div className="material-text-file"><b>ZIP</b><p>这是包含全部当前分集成片、字幕和校验清单的整剧交付包，请下载后使用。</p></div> : <div className="material-text-file"><b>TXT</b><p>这是小飞象生成或归档的字幕/文本文件，可直接下载查看。</p></div> : <div className="material-file-missing"><b>文件尚不可用</b><p>该资产记录存在，但没有可读取的存储文件。</p></div>}</div>
    <div className="modal-footer"><AppButton onClick={onClose}>关闭</AppButton>{asset.thumbnailUrl && <a className="app-button" href={asset.thumbnailUrl} download>下载文件</a>}</div>
  </div></div>;
}

type JobProgress = { overall?: number; stage?: string; currentNodeTitle?: string | null; nodeValue?: number | null; nodeMax?: number | null };

function VisualAssetModal({ projectId, project, asset, onGenerated, onClose }: { projectId: string; project: ProjectSummary; asset: ProjectAsset; onGenerated: () => void; onClose: () => void }) {
  const label = asset.assetType === "scene" ? "场景标准图" : "道具标准图";
  const [prompt, setPrompt] = useState(`${asset.assetType === "scene" ? "场景" : "关键道具"}：${asset.name}。设定：${assetDescription(asset)}。视觉风格：${project.stylePreset}。生成可在全剧分镜中稳定复用的${label}，不要添加无关角色或文字水印。`);
  const [assetUrl, setAssetUrl] = useState(asset.thumbnailUrl);
  const [currentAssetId, setCurrentAssetId] = useState(asset.id);
  const [locked, setLocked] = useState(visualAssetReady(asset));
  const [locking, setLocking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setAssetUrl(asset.thumbnailUrl);
    setCurrentAssetId(asset.id);
    setLocked(visualAssetReady(asset));
  }, [asset.id, asset.metadataJson, asset.status, asset.thumbnailUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [projectResponse, jobsResponse] = await Promise.all([
          fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
          fetch(`/api/generation/jobs?projectId=${projectId}`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (projectResponse.ok) {
          const data = await projectResponse.json() as ProjectAssetsResponse;
          const latest = data.assets.find((item) => item.id === asset.id);
          if (latest) {
            setAssetUrl(latest.thumbnailUrl);
            setCurrentAssetId(latest.id);
            setLocked(visualAssetReady(latest));
          }
        }
        if (jobsResponse.ok) {
          const data = await jobsResponse.json() as { jobs?: ProjectGenerationJob[] };
          const activeJob = findActiveGenerationJob(data.jobs, { entityType: "asset", entityId: asset.id, capabilities: ["image_generation"] });
          if (activeJob) {
            setJobId(activeJob.id);
            setMessage("已恢复进行中的生成任务，关闭弹窗也不会中断 Spark 执行");
          }
        }
      } catch {
        // Keep modal usable with the cached asset snapshot if refresh fails.
      }
    })();
    return () => { cancelled = true; };
  }, [asset.id, projectId]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const response = await fetch(`/api/generation/jobs/${jobId}`, { cache: "no-store" });
      const data = await response.json() as { job?: { status: string; errorMessage?: string; progress?: JobProgress; result?: { assetId?: string; assetUrl?: string } } };
      if (cancelled || !data.job) return;
      setProgress(data.job.progress ?? null);
      if (["queued", "running", "submitting"].includes(data.job.status)) {
        setMessage(data.job.progress?.stage ?? "任务已进入 Spark 队列");
        timer = window.setTimeout(poll, 1600);
        return;
      }
      setJobId(null);
      if (data.job.status === "succeeded") {
        setAssetUrl(data.job.result?.assetUrl ?? null);
        setCurrentAssetId(data.job.result?.assetId ?? asset.id);
        setLocked(false);
        setProgress({ overall: 100, stage: `${label}已生成并回写` });
        setMessage(`${label}已由 ComfyUI 真实生成并保存`);
        onGenerated();
      } else {
        setProgress(null);
        setMessage(`生成失败：${data.job.errorMessage ?? `请检查${label}工作流`}`);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [jobId, label, onGenerated]);

  const generate = async () => {
    setProgress({ overall: 2, stage: "正在提交到 Spark" });
    setMessage(`正在提交${label}工作流…`);
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, entityType: "asset", entityId: asset.id, capability: "image_generation", payload: { prompt, aspectRatio: project.aspectRatio, stylePreset: project.stylePreset } }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string } };
    if (!response.ok || !data.job?.id) {
      setProgress(null);
      setMessage(data.error?.message ?? `${label}任务提交失败`);
      return;
    }
    setJobId(data.job.id);
    setMessage("任务已提交，等待 Spark 执行");
  };
  const lockAsset = async () => {
    if (!assetUrl || locking) return;
    setLocking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${currentAssetId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visualLocked: true }) });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "视觉资产锁定失败");
      setLocked(true);
      setMessage(`${label}已确认并锁定，后续片段将引用这个版本`);
      onGenerated();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "视觉资产锁定失败");
    } finally {
      setLocking(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="visual-asset-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">项目级视觉资产</p><h2>{asset.name} · {label}</h2></div><button onClick={onClose}>×</button></div>
    <div className="visual-asset-modal-body">
      <div className={`visual-asset-preview ${assetUrl ? "has-real-asset" : "missing-real-asset"}`} style={assetUrl ? { backgroundImage: `url(${assetUrl})` } : undefined}>{!assetUrl && <span>尚未生成真实图片</span>}</div>
      <div className="visual-asset-form"><div className="voice-section-title"><div><h3>{label}</h3><p>生成结果会先进入待确认状态；锁定后，所有引用它的片段才使用这个版本。</p></div><span className={locked ? "saved-state" : "pending-state"}>{locked ? "✓ 已锁定" : assetUrl ? "待确认" : "待生成"}</span></div><label>生成要求<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>{progress && <div className="real-generation-progress"><div><span>{progress.stage ?? message}</span><b>{Math.round(progress.overall ?? 0)}%</b></div><i><em style={{ width: `${Math.max(2, progress.overall ?? 0)}%` }} /></i>{progress.currentNodeTitle && <small>当前节点：{progress.currentNodeTitle}{progress.nodeMax ? ` · ${progress.nodeValue ?? 0}/${progress.nodeMax}` : ""}</small>}</div>}{message && !progress && <p className="generation-message">{message}</p>}<div className="voice-consistency-note"><b>跨集复用</b><p>重新生成会保留历史生成文件，并撤销当前锁定；只有你确认的新版本会进入分镜。</p></div></div>
    </div>
    <div className="modal-footer"><AppButton onClick={onClose}>关闭</AppButton>{assetUrl && <AppButton disabled={Boolean(jobId) || locking} onClick={() => void generate()}>{jobId ? "ComfyUI 正在生成…" : `重新生成${label}`}</AppButton>}<AppButton primary disabled={Boolean(jobId) || locking || !prompt.trim() || (Boolean(assetUrl) && locked)} onClick={() => void (assetUrl ? lockAsset() : generate())}>{jobId ? "ComfyUI 正在生成…" : locking ? "正在锁定…" : !assetUrl ? `生成${label}` : locked ? "已锁定" : "确认并锁定"}</AppButton></div>
  </div></div>;
}

function EnvironmentModal({ projectId, sceneAsset, preset, onClose, onSaved }: { projectId: string; sceneAsset: ProjectAsset; preset: AudioPreset | null; onClose: () => void; onSaved: (preset: AudioPreset) => void }) {
  const [description, setDescription] = useState(preset?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!description.trim()) return setError("请描述这个场景持续存在的环境声音");
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/audio-presets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneAssetId: sceneAsset.id, description, locked: true }) });
      if (!response.ok) throw new Error("场景声音场保存失败");
      const data = await response.json() as { preset: AudioPreset };
      onSaved(data.preset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "场景声音场保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}><div className="environment-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">场景声音场</p><h2>{sceneAsset.name}</h2></div><button onClick={onClose}>×</button></div>
      <div className="environment-modal-body"><div className="sound-field-visual"><span>环境底噪</span><i /><i /><i /><i /><i /></div><h3>整场统一的声音基线</h3><p>描述空间大小、混响、持续底噪和标志性环境声。所有引用该场景的分镜都会继承此配置，再叠加镜头事件音。</p><label>声音场描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：空旷旧教室，轻微风声从破窗进入，远处操场偶有鸟鸣，室内带短促混响…" /></label><div className="environment-rules"><span>✓ 跨分镜继承</span><span>✓ 统一空间混响</span><span>✓ 镜头事件音单独叠加</span></div>{error && <p className="modal-error">{error}</p>}</div>
      <div className="modal-footer"><AppButton onClick={onClose}>取消</AppButton><AppButton primary disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存并锁定声音场"}</AppButton></div>
    </div></div>
  );
}
