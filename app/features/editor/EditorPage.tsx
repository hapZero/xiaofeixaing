"use client";

import { useEffect, useMemo, useState } from "react";
import { AppButton, Pill } from "../../components/ui";
import { useStudioAuth } from "../auth/AuthContext";
import { useSettings } from "../settings/SettingsProvider";
import type { ProjectProductionDetail, ProjectShot, ProjectSummary, SegmentVersion, View } from "../studio/types";
import { SegmentAssetSidebar, SegmentDirectorPrompt, SegmentEpisodeRail, SegmentFrameReviewStrip, SegmentPhonePreview, SegmentPromptCanvas, SegmentReferencePicker, SegmentShotProductionPanel, SegmentVersionGallery, type SegmentReferenceData } from "./SegmentWorkbenchParts";
import { buildSegmentReferences, episodeReferenceKeys, shotGenerationReferenceKeys, shotGenerationReferenceLabels, type SegmentReferenceView } from "./segment-workbench";
import { parseShotGenerationPlan, readShotVideoCapabilitySelection, shotVideoCapabilityOptions, type ShotVideoCapability } from "../../lib/shot-video-capability";

type JobProgress = { overall?: number; stage?: string; currentNodeTitle?: string | null; nodeValue?: number | null; nodeMax?: number | null };
type SegmentPlan = {
  status: "ready" | "blocked";
  steps: Array<{ id: string; scope: "segment" | "shot"; entityId: string; capability: string; capabilityName: string; purpose: string }>;
  requiredCapabilities: string[];
  missingCapabilities: string[];
  missingCapabilityDetails: Array<{ key: string; name: string; reason: string; productionRoute: string }>;
  missingSoundCapabilities?: string[];
  missingSoundCapabilityDetails?: Array<{ key: string; name: string; reason: string; productionRoute: string }>;
  internalBlockers: string[];
  missingAssets: Array<{ type: string; id: string; name: string; reason: string }>;
  soundEnhancement: { status: "native" | "pending" | "not_required"; message: string };
  productionMode: "unified_segment" | "stitched_shots";
  promptPreview: string;
  promptSource: "manual" | "automatic";
  referenceMode: "manual" | "automatic";
  referenceWiring?: {
    hasReferences: boolean;
    wired: boolean;
    bindingName: string | null;
    bindingCapability: string | null;
    message: string;
  };
};

type SegmentGenerationResponse = {
  stage?: "first_frame" | "shot_video" | "segment_video" | "voice_synthesis" | "compose" | "complete" | "awaiting_frame_review";
  parallel?: boolean;
  parallelJob?: { id: string; capability: "voice_synthesis" };
  capability?: ShotVideoCapabilityName | "voice_synthesis";
  job?: { id: string; capability: ShotVideoCapabilityName | "voice_synthesis"; entityId?: string };
  mediaJob?: { id: string; status: string; progress?: number };
  progress?: { framesReady?: number; videosReady?: number; shotTotal?: number };
  result?: { assetId: string; assetUrl: string; versionNumber: number };
  message?: string;
  error?: { message?: string };
};

type SegmentGenerationStatusResponse = {
  segment?: { status: string; videoAssetId: string | null };
  stage: "first_frame" | "shot_video" | "segment_video" | "compose" | null;
  activeJob: { id: string; status: string; capability: ShotVideoCapabilityName } | null;
  mediaJob: { id: string; status: string; progress: number } | null;
  resumeRequired: boolean;
  lastFailure: { errorMessage?: string | null } | null;
};

type SoundCapability = "voice_synthesis" | "ambient_audio" | "lip_sync";
type ShotVideoCapabilityName = "storyboard_frame" | "image_to_video" | "multi_subject_video" | "first_last_frame_video" | "native_audio_video";
type EditorCapability = ShotVideoCapabilityName | SoundCapability;
type SegmentSoundResponse = {
  stage?: SoundCapability | "media" | "complete";
  job?: { id: string; capability: SoundCapability };
  mediaJob?: { id: string; status: string; progress?: number };
  message?: string;
  assetUrl?: string;
  error?: { message?: string };
};
type SegmentSoundStatusResponse = {
  status: "complete" | "running" | "ready_to_continue" | "waiting_video";
  activeJob: { id: string; capability: SoundCapability; status: string } | null;
  mediaJob: { id: string; operation: string; status: string; progress: number; errorMessage?: string | null } | null;
  resumeRequired: boolean;
  blockers: Array<{ name: string; reason: string; characterId?: string }>;
  lastFailure: { errorCode?: string | null; errorMessage?: string | null } | null;
};

function generationStage(value: SegmentGenerationResponse["stage"] | SegmentGenerationStatusResponse["stage"]) {
  return value === "first_frame" || value === "shot_video" || value === "segment_video" ? value : null;
}

type SegmentQuality = {
  structural?: { passed?: boolean; score?: number; issues?: Array<{ severity?: string; message?: string; suggestion?: string }> };
  semantic?: { status?: string; passed?: boolean; score?: number; summary?: string; issues?: Array<{ severity?: string; message?: string; suggestion?: string }> };
  overall?: { status?: string; score?: number };
  review?: { decision?: "approved" | "rejected"; mode?: string; reviewedAt?: string; note?: string | null };
};
type SegmentQualityStatusResponse = {
  version?: SegmentVersion | null;
  quality?: SegmentQuality;
  visionConfigured?: boolean;
  activeReview?: { id: string; status: string; progress: number } | null;
  lastFailure?: { errorCode?: string | null; errorMessage?: string | null } | null;
};

async function requestSegmentGeneration(projectId: string, segmentId: string, options: { force?: boolean; confirmFrames?: boolean; regenFrames?: boolean } = {}): Promise<{ ok: boolean; data: SegmentGenerationResponse }> {
  const response = await fetch(`/api/projects/${projectId}/segments/${segmentId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: Boolean(options.force), confirmFrames: Boolean(options.confirmFrames), regenFrames: Boolean(options.regenFrames) }) });
  return { ok: response.ok, data: await response.json() as SegmentGenerationResponse };
}

async function requestSegmentSound(projectId: string, segmentId: string): Promise<{ ok: boolean; data: SegmentSoundResponse }> {
  const response = await fetch(`/api/projects/${projectId}/segments/${segmentId}/sound`, { method: "POST" });
  return { ok: response.ok, data: await response.json() as SegmentSoundResponse };
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const strategyNames: Record<string, string> = {
  image_to_video: "单人/空镜图生视频",
  multi_subject_video: "多角色视频",
  first_last_frame: "首尾帧视频",
  first_last_frame_video: "首尾帧视频",
  lip_sync: "固定音色配音＋口型同步",
  native_audio_video: "原生有声视频",
  video_character_replace: "视频角色替换",
};

export function EditorPage({ onNavigate, project: initialProject, initialEpisodeId }: { onNavigate: (view: View) => void; project: ProjectSummary | null; initialEpisodeId: string | null }) {
  const { user } = useStudioAuth();
  const { openSettings } = useSettings();
  const accountAvatar = user.displayName.trim().slice(0, 1).toUpperCase() || "飞";
  const [detail, setDetail] = useState<ProjectProductionDetail | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(initialEpisodeId);
  const [segment, setSegment] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [saveState, setSaveState] = useState<"已保存" | "保存中" | "保存失败">("已保存");
  const [generationState, setGenerationState] = useState("");
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [parallelGenerationJobId, setParallelGenerationJobId] = useState<string | null>(null);
  const [generationCapability, setGenerationCapability] = useState<EditorCapability>("storyboard_frame");
  const [generationResultUrl, setGenerationResultUrl] = useState<string | null>(null);
  const [videoResultUrl, setVideoResultUrl] = useState<string | null>(null);
  const [previewSegmentVersionAssetId, setPreviewSegmentVersionAssetId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<JobProgress | null>(null);
  const [generationScope, setGenerationScope] = useState<"shot" | "segment" | "sound">("shot");
  const [segmentGenerationStage, setSegmentGenerationStage] = useState<"first_frame" | "shot_video" | "segment_video" | "voice_synthesis" | "ambient_audio" | "lip_sync" | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
  const [segmentPlan, setSegmentPlan] = useState<SegmentPlan | null>(null);
  const [planRefreshTick, setPlanRefreshTick] = useState(0);
  const [segmentQuality, setSegmentQuality] = useState<SegmentQuality | null>(null);
  const [visionConfigured, setVisionConfigured] = useState(false);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualityDecisionPending, setQualityDecisionPending] = useState<"approved" | "rejected" | null>(null);
  const [qualityMessage, setQualityMessage] = useState("");
  const [qualityPollTick, setQualityPollTick] = useState(0);
  const [selectingVersionId, setSelectingVersionId] = useState<string | null>(null);
  const [segmentPromptDraft, setSegmentPromptDraft] = useState("");
  const [segmentPromptSaveState, setSegmentPromptSaveState] = useState("自动指令");
  const [savingSegmentPrompt, setSavingSegmentPrompt] = useState(false);
  const [segmentReferenceData, setSegmentReferenceData] = useState<SegmentReferenceData | null>(null);
  const [segmentReferencePickerOpen, setSegmentReferencePickerOpen] = useState(false);
  const [segmentReferenceSelectedKeys, setSegmentReferenceSelectedKeys] = useState<string[]>([]);
  const [savingSegmentReferences, setSavingSegmentReferences] = useState(false);
  const [segmentReferenceMessage, setSegmentReferenceMessage] = useState("");
  const [assetScope, setAssetScope] = useState<"episode" | "all">("episode");
  const [assetCategory, setAssetCategory] = useState<"character" | "scene" | "prop" | "material">("character");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [frameReviewOpen, setFrameReviewOpen] = useState(true);
  const [framePreviewByShotId, setFramePreviewByShotId] = useState<Record<string, string>>({});
  const [generationEntityId, setGenerationEntityId] = useState<string | null>(null);
  const [episodeRenderBusy, setEpisodeRenderBusy] = useState(false);
  const [videoCapability, setVideoCapability] = useState<ShotVideoCapability>("image_to_video");
  const [videoCapabilitySaveState, setVideoCapabilitySaveState] = useState("已保存");
  const [soundRetryAvailable, setSoundRetryAvailable] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialProject));
  const projectId = initialProject?.id ?? null;
  const allShots = useMemo(() => {
    if (!detail) return [];
    const episodeOrder = new Map(detail.episodes.map((episode) => [episode.id, episode.episodeNumber]));
    const segmentOrder = new Map(detail.segments.map((item) => [item.id, item.sequence]));
    return [...detail.shots].sort((a, b) => (episodeOrder.get(a.episodeId) ?? 0) - (episodeOrder.get(b.episodeId) ?? 0) || (segmentOrder.get(a.segmentId ?? "") ?? 0) - (segmentOrder.get(b.segmentId ?? "") ?? 0) || a.sequence - b.sequence);
  }, [detail]);
  const resolvedEpisodeId = activeEpisodeId && detail?.episodes.some((episode) => episode.id === activeEpisodeId) ? activeEpisodeId : detail?.episodes[0]?.id ?? null;
  const shots = useMemo(() => allShots.filter((shot) => shot.episodeId === resolvedEpisodeId), [allShots, resolvedEpisodeId]);
  const selectedShot = shots[segment] ?? null;
  const selectedSegment = detail?.segments.find((item) => item.id === selectedShot?.segmentId) ?? null;
  const selectedSegmentVersionNumber = selectedSegment?.currentVersionNumber;
  const selectedEpisode = detail?.episodes.find((episode) => episode.id === resolvedEpisodeId) ?? null;
  const selectedFrameAsset = detail?.assets.find((asset) => asset.id === selectedShot?.firstFrameAssetId) ?? null;
  const selectedVideoAsset = detail?.assets.find((asset) => asset.id === selectedShot?.videoAssetId) ?? null;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("分镜编辑器加载失败");
        return response.json() as Promise<ProjectProductionDetail>;
      })
      .then((data) => {
        if (cancelled) return;
        const preferredEpisodeId = initialEpisodeId && data.episodes.some((episode) => episode.id === initialEpisodeId) ? initialEpisodeId : data.episodes[0]?.id ?? null;
        const orderedShots = data.shots.filter((shot) => shot.episodeId === preferredEpisodeId).sort((a, b) => a.sequence - b.sequence);
        setDetail(data);
        setActiveEpisodeId(preferredEpisodeId);
        setSegment(0);
        setPrompt(orderedShots[0]?.prompt ?? "");
      })
      .catch((reason: unknown) => { if (!cancelled) setGenerationState(reason instanceof Error ? reason.message : "分镜编辑器加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialEpisodeId, projectId]);

  useEffect(() => {
    if (!generationJobId || !projectId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const response = await fetch(`/api/generation/jobs/${generationJobId}`, { cache: "no-store" });
      const data = await response.json() as { job?: { status: string; entityId?: string; entityType?: string; errorMessage?: string; progress?: JobProgress; result?: { assetUrl?: string; assetId?: string; mediaType?: string } } };
      if (cancelled || !data.job) return;
      setGenerationProgress(data.job.progress ?? null);
      if (["queued", "running", "submitting"].includes(data.job.status)) {
        setGenerationState(data.job.progress?.stage ?? (data.job.status === "running" ? `ComfyUI 正在生成${generationScope === "segment" && segmentGenerationStage === "segment_video" ? "片段" : generationCapability === "storyboard_frame" ? "分镜首帧" : "分镜视频"}…` : "任务正在等待 Spark 执行…"));
        timer = window.setTimeout(poll, 1600);
        return;
      }
      setGenerationJobId(null);
      if (data.job.status === "succeeded") {
        setGenerationProgress({ overall: 100, stage: "结果已归档" });
        const resultAssetId = data.job.result?.assetId ?? null;
        const resultAssetUrl = data.job.result?.assetUrl ?? null;
        const resultShotId = data.job.entityType === "shot" ? (data.job.entityId ?? generationEntityId) : null;
        if (["image_to_video", "multi_subject_video", "first_last_frame_video", "native_audio_video", "lip_sync"].includes(generationCapability)) setVideoResultUrl(resultAssetUrl);
        else setGenerationResultUrl(resultAssetUrl);
        if (generationCapability === "storyboard_frame" && resultShotId && resultAssetId && resultAssetUrl) {
          setFrameReviewOpen(true);
          setFramePreviewByShotId((current) => ({ ...current, [resultShotId]: resultAssetUrl }));
          setDetail((current) => {
            if (!current) return current;
            const existing = current.assets.find((asset) => asset.id === resultAssetId);
            return {
              ...current,
              shots: current.shots.map((shot) => shot.id === resultShotId ? { ...shot, firstFrameAssetId: resultAssetId, status: "frame_ready" } : shot),
              assets: existing ? current.assets.map((asset) => asset.id === resultAssetId ? { ...asset, thumbnailUrl: resultAssetUrl, status: "ready" } : asset) : [
                ...current.assets,
                {
                  id: resultAssetId,
                  projectId,
                  episodeId: current.shots.find((shot) => shot.id === resultShotId)?.episodeId ?? null,
                  assetType: "storyboard_frame_image",
                  sourceRevision: null,
                  name: "分镜首帧",
                  status: "ready",
                  storageKey: null,
                  thumbnailUrl: resultAssetUrl,
                  metadataJson: "{}",
                },
              ],
            };
          });
        }
        const detailResponse = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (detailResponse.ok && !cancelled) {
          setDetail(await detailResponse.json() as ProjectProductionDetail);
          setPlanRefreshTick((current) => current + 1);
        }
        if (generationScope === "segment" && ["first_frame", "shot_video"].includes(segmentGenerationStage ?? "") && activeSegmentId) {
          setGenerationState(segmentGenerationStage === "first_frame" ? "当前首帧已完成，正在检查是否需要你确认…" : "当前分镜视频已完成，正在继续下一个分镜…");
          const next = await requestSegmentGeneration(projectId, activeSegmentId);
          if (!next.ok || !next.data.stage) {
            setGenerationProgress(null);
            setSegmentGenerationStage(null);
            setGenerationState(next.data.error?.message ?? "片段生产续跑失败");
            return;
          }
          if (next.data.stage === "awaiting_frame_review") {
            setGenerationProgress(null);
            setSegmentGenerationStage(null);
            setFrameReviewOpen(true);
            setGenerationState(next.data.message ?? "请确认底部全部首帧后，再生成视频");
            const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
            if (refreshed.ok && !cancelled) setDetail(await refreshed.json() as ProjectProductionDetail);
            return;
          }
          if (next.data.stage === "complete") {
            setVideoResultUrl(next.data.result?.assetUrl ?? null);
            setGenerationState("片段画面已合成，正在处理声音…");
            const sound = await requestSegmentSound(projectId, activeSegmentId);
            if (!sound.ok) {
              setGenerationProgress(null);
              setSegmentGenerationStage(null);
              setGenerationState(sound.data.error?.message ?? "声音任务提交失败");
              return;
            }
            if (sound.data.stage === "complete") {
              setGenerationProgress({ overall: 100, stage: "完整片段已完成" });
              setSegmentGenerationStage(null);
              setGenerationState(sound.data.message ?? next.data.message ?? "完整片段已完成");
              if (sound.data.assetUrl) setVideoResultUrl(sound.data.assetUrl);
              const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
              if (refreshed.ok && !cancelled) setDetail(await refreshed.json() as ProjectProductionDetail);
              return;
            }
            if (sound.data.stage === "media" && sound.data.mediaJob) {
              setGenerationScope("sound");
              setGenerationState(sound.data.message ?? "正在恢复片段声音合成任务");
              setGenerationProgress({ overall: sound.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
              setRestoreTick((current) => current + 1);
              return;
            }
            if (sound.data.job?.id && sound.data.stage) {
              setGenerationScope("sound");
              setSegmentGenerationStage(sound.data.job.capability);
              setGenerationCapability(sound.data.job.capability);
              setGenerationJobId(sound.data.job.id);
              setGenerationProgress({ overall: 2, stage: sound.data.message ?? "声音任务已进入队列" });
              return;
            }
            setGenerationProgress({ overall: 100, stage: "片段画面已完成" });
            setSegmentGenerationStage(null);
            return;
          }
          if (next.data.stage === "compose" && next.data.mediaJob) {
            setGenerationState(next.data.message ?? "正在恢复片段合成任务");
            setGenerationProgress({ overall: next.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在合成多个分镜" });
            setRestoreTick((current) => current + 1);
            return;
          }
          if (!next.data.job?.id) {
            setGenerationProgress(null);
            setSegmentGenerationStage(null);
            setGenerationState("片段生产没有返回可继续的任务");
            return;
          }
          setSegmentGenerationStage(generationStage(next.data.stage));
          setGenerationCapability(next.data.job.capability);
          setGenerationEntityId(next.data.job.entityId ?? null);
          setGenerationJobId(next.data.job.id);
          if (next.data.stage === "first_frame") setFrameReviewOpen(true);
          setGenerationProgress({ overall: 2, stage: next.data.message ?? "整段视频已进入队列" });
          return;
        }
        if (generationScope === "segment" && segmentGenerationStage === "segment_video" && activeSegmentId && generationCapability !== "native_audio_video") {
          setGenerationState("片段画面已完成，正在生成固定音色与声音…");
          const next = await requestSegmentSound(projectId, activeSegmentId);
          if (!next.ok) {
            setGenerationProgress(null);
            setSegmentGenerationStage(null);
            setGenerationState(next.data.error?.message ?? "声音任务提交失败");
            return;
          }
          if (next.data.stage === "complete") {
            setSegmentGenerationStage(null);
            setGenerationState(next.data.message ?? "完整片段已完成");
            if (next.data.assetUrl) setVideoResultUrl(next.data.assetUrl);
            return;
          }
          if (next.data.stage === "media" && next.data.mediaJob) {
            setGenerationScope("sound");
            setGenerationState(next.data.message ?? "正在恢复片段声音合成任务");
            setGenerationProgress({ overall: next.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
            setRestoreTick((current) => current + 1);
            return;
          }
          if (next.data.job?.id && next.data.stage) {
            setGenerationScope("sound");
            setSegmentGenerationStage(next.data.job.capability);
            setGenerationCapability(next.data.job.capability);
            setGenerationJobId(next.data.job.id);
            setGenerationProgress({ overall: 2, stage: next.data.message ?? "声音任务已进入队列" });
            return;
          }
        }
        if (generationScope === "sound" && activeSegmentId) {
          setGenerationState("当前声音步骤已完成，正在继续片段声音生产…");
          const next = await requestSegmentSound(projectId, activeSegmentId);
          if (!next.ok) {
            setGenerationProgress(null);
            setSegmentGenerationStage(null);
            setGenerationState(next.data.error?.message ?? "声音任务续跑失败");
            return;
          }
          if (next.data.stage === "complete") {
            setSegmentGenerationStage(null);
            setGenerationState(next.data.message ?? "片段声音与口型已经完成");
            if (next.data.assetUrl) setVideoResultUrl(next.data.assetUrl);
            const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
            if (refreshed.ok && !cancelled) setDetail(await refreshed.json() as ProjectProductionDetail);
            return;
          }
          if (next.data.stage === "media" && next.data.mediaJob) {
            setGenerationState(next.data.message ?? "正在恢复片段声音合成任务");
            setGenerationProgress({ overall: next.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
            setRestoreTick((current) => current + 1);
            return;
          }
          if (next.data.job?.id && next.data.stage) {
            setSegmentGenerationStage(next.data.job.capability);
            setGenerationCapability(next.data.job.capability);
            setGenerationJobId(next.data.job.id);
            setGenerationProgress({ overall: 2, stage: next.data.message ?? "正在继续声音生产" });
            return;
          }
        }
        setSegmentGenerationStage(null);
        setGenerationState(generationScope === "segment" ? "片段已生成、归档并建立新版本" : "当前分镜结果已更新，请重新生成片段以建立新候选版本");
      } else {
        setGenerationState(`生成失败：${data.job.errorMessage ?? "请检查工作流输出映射"}`);
        if (generationScope === "sound") setSoundRetryAvailable(true);
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeSegmentId, generationCapability, generationEntityId, generationJobId, generationScope, projectId, segmentGenerationStage]);

  useEffect(() => {
    if (!parallelGenerationJobId || !projectId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const response = await fetch(`/api/generation/jobs/${parallelGenerationJobId}`, { cache: "no-store" });
      const data = await response.json() as { job?: { status: string } };
      if (cancelled || !data.job) return;
      if (["queued", "running", "submitting"].includes(data.job.status)) {
        timer = window.setTimeout(poll, 1800);
        return;
      }
      setParallelGenerationJobId(null);
      const detailResponse = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (detailResponse.ok && !cancelled) {
        setDetail(await detailResponse.json() as ProjectProductionDetail);
        setPlanRefreshTick((current) => current + 1);
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [parallelGenerationJobId, projectId]);

  useEffect(() => {
    if (!projectId || !selectedShot?.segmentId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/segments/${selectedShot.segmentId}/production-plan`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("片段生产计划读取失败");
        return response.json() as Promise<{ plan: SegmentPlan }>;
      })
      .then((data) => { if (!cancelled) setSegmentPlan(data.plan); })
      .catch((reason: unknown) => { if (!cancelled) setGenerationState(reason instanceof Error ? reason.message : "片段生产计划读取失败"); });
    return () => { cancelled = true; };
  }, [planRefreshTick, projectId, selectedShot?.segmentId]);

  useEffect(() => {
    if (!segmentPlan?.promptPreview) return;
    setSegmentPromptDraft(segmentPlan.promptPreview);
    setSegmentPromptSaveState(segmentPlan.promptSource === "manual" ? "已保存人工调整版" : "自动指令");
  }, [segmentPlan?.promptPreview, segmentPlan?.promptSource, selectedShot?.segmentId]);

  useEffect(() => {
    if (!projectId || !selectedShot?.segmentId) {
      setSegmentReferenceData(null);
      setSegmentReferenceSelectedKeys([]);
      return;
    }
    let cancelled = false;
    setSegmentReferenceData(null);
    setSegmentReferenceMessage("");
    fetch(`/api/projects/${projectId}/segments/${selectedShot.segmentId}/references`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as SegmentReferenceData & { error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "片段参考素材读取失败");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setSegmentReferenceData(data);
        setSegmentReferenceSelectedKeys(data.selectedKeys);
      })
      .catch((error: unknown) => { if (!cancelled) setSegmentReferenceMessage(error instanceof Error ? error.message : "片段参考素材读取失败"); });
    return () => { cancelled = true; };
  }, [projectId, selectedShot?.segmentId]);

  useEffect(() => {
    if (!projectId || !selectedShot?.segmentId) return;
    let cancelled = false;
    let timer = 0;
    fetch(`/api/projects/${projectId}/segments/${selectedShot.segmentId}/quality`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("片段质检状态读取失败");
        return response.json() as Promise<SegmentQualityStatusResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setSegmentQuality(data.quality ?? null);
        setVisionConfigured(Boolean(data.visionConfigured));
        if (data.version) setDetail((current) => current ? { ...current, segmentVersions: current.segmentVersions.map((version) => version.id === data.version?.id ? data.version : version) } : current);
        if (data.activeReview) {
          setQualityChecking(true);
          setQualityMessage(`视觉质检正在后台执行 · ${data.activeReview.progress}%`);
          timer = window.setTimeout(() => setQualityPollTick((current) => current + 1), 1_600);
        } else {
          setQualityChecking(false);
          if (data.lastFailure?.errorMessage) setQualityMessage(`上次质检失败：${data.lastFailure.errorMessage}`);
          else if (data.quality?.review?.decision === "approved") setQualityMessage("当前片段版本已由创作者确认，可进入整集合成");
          else if (data.quality?.review?.decision === "rejected") setQualityMessage("当前片段版本已标记为需重做");
          else if (data.quality?.overall?.status === "passed") setQualityMessage("当前片段版本已通过连续性质检");
          else if (data.quality?.overall?.status === "failed") setQualityMessage("当前片段存在需要重做的连续性问题");
        }
      })
      .catch((error: unknown) => { if (!cancelled) setQualityMessage(error instanceof Error ? error.message : "片段质检状态读取失败"); });
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, qualityPollTick, selectedSegmentVersionNumber, selectedShot?.segmentId]);

  useEffect(() => {
    if (!projectId || !selectedShot?.segmentId || generationJobId) return;
    const segmentId = selectedShot.segmentId;
    let cancelled = false;
    let timer = 0;
    const restore = async () => {
      const response = await fetch(`/api/projects/${projectId}/segments/${segmentId}/generate`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const status = await response.json() as SegmentGenerationStatusResponse;
      if (cancelled) return;
      if (status.activeJob && status.stage) {
        setGenerationScope("segment");
        setActiveSegmentId(segmentId);
        setSegmentGenerationStage(generationStage(status.stage));
        setGenerationCapability(status.activeJob.capability);
        setGenerationJobId(status.activeJob.id);
        setGenerationState(status.stage === "first_frame" ? "已恢复片段起始画面任务" : "已恢复片段生成任务");
        return;
      }
      if (status.mediaJob && status.stage === "compose") {
        setGenerationScope("segment");
        setActiveSegmentId(segmentId);
        setGenerationState(`正在恢复片段合成任务 · ${status.mediaJob.progress ?? 5}%`);
        setGenerationProgress({ overall: status.mediaJob.progress ?? 5, stage: "FFmpeg 正在合成多个分镜" });
        timer = window.setTimeout(restore, 1_600);
        return;
      }
      if (status.resumeRequired) {
        const next = await requestSegmentGeneration(projectId, segmentId);
        if (cancelled) return;
        if (next.ok && next.data.stage === "awaiting_frame_review") {
          setGenerationScope("segment");
          setActiveSegmentId(segmentId);
          setGenerationProgress(null);
          setGenerationJobId(null);
          setSegmentGenerationStage(null);
          setFrameReviewOpen(true);
          setGenerationState(next.data.message ?? "请确认底部全部首帧后，再生成视频");
          return;
        }
        if (next.ok && next.data.stage === "compose" && next.data.mediaJob) {
          setGenerationScope("segment");
          setActiveSegmentId(segmentId);
          setGenerationState(next.data.message ?? "正在恢复片段合成任务");
          setGenerationProgress({ overall: next.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在合成多个分镜" });
          timer = window.setTimeout(restore, 1_600);
          return;
        }
        if (next.ok && next.data.job?.id && next.data.stage && next.data.stage !== "complete") {
          setGenerationScope("segment");
          setActiveSegmentId(segmentId);
          setSegmentGenerationStage(generationStage(next.data.stage));
          setGenerationCapability(next.data.job.capability);
          setGenerationJobId(next.data.job.id);
          setGenerationState("已从上次进度继续生成片段");
          return;
        }
        if (!next.ok) {
          setGenerationProgress(null);
          setGenerationJobId(null);
          setGenerationState(next.data.error?.message ?? "片段生成恢复失败，可再次点击「生成片段」");
        }
        return;
      }
      if (status.lastFailure?.errorMessage) setGenerationState(`上次片段生成失败：${status.lastFailure.errorMessage}`);
      if (status.segment?.videoAssetId && status.segment.status !== "video_audio_ready") {
        const soundResponse = await fetch(`/api/projects/${projectId}/segments/${segmentId}/sound`, { cache: "no-store" });
        if (!soundResponse.ok || cancelled) return;
        const sound = await soundResponse.json() as SegmentSoundStatusResponse;
        if (sound.activeJob) {
          setGenerationScope("sound");
          setActiveSegmentId(segmentId);
          setSegmentGenerationStage(sound.activeJob.capability);
          setGenerationCapability(sound.activeJob.capability);
          setGenerationJobId(sound.activeJob.id);
          setGenerationState("已恢复片段声音任务");
          return;
        }
        if (sound.status === "running" && sound.mediaJob) {
          setGenerationScope("sound");
          setActiveSegmentId(segmentId);
          setGenerationState(`正在恢复片段声音合成 · ${sound.mediaJob.progress ?? 5}%`);
          setGenerationProgress({ overall: sound.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
          timer = window.setTimeout(restore, 1_600);
          return;
        }
        if (sound.lastFailure?.errorMessage) {
          setGenerationProgress(null);
          setSoundRetryAvailable(true);
          setGenerationState(`上次声音处理失败：${sound.lastFailure.errorMessage}`);
          return;
        }
        if (sound.resumeRequired && !sound.blockers.length) {
          const next = await requestSegmentSound(projectId, segmentId);
          if (next.ok && next.data.stage === "media" && next.data.mediaJob) {
            setGenerationScope("sound");
            setActiveSegmentId(segmentId);
            setGenerationState(next.data.message ?? "正在恢复片段声音合成任务");
            setGenerationProgress({ overall: next.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
            timer = window.setTimeout(restore, 1_600);
            return;
          }
          if (next.ok && next.data.job?.id && next.data.stage && next.data.stage !== "complete") {
            setGenerationScope("sound");
            setActiveSegmentId(segmentId);
            setSegmentGenerationStage(next.data.job.capability);
            setGenerationCapability(next.data.job.capability);
            setGenerationJobId(next.data.job.id);
            setGenerationState(next.data.message ?? "已从上次进度继续声音生产");
          } else if (!next.ok) setGenerationState(next.data.error?.message ?? "声音生产恢复失败");
        } else if (sound.blockers.length) {
          const unique = [...new Map(sound.blockers.map((item) => [item.name, item])).values()];
          setGenerationState(`配音还差一步：${unique.map((item) => `${item.name}（${item.reason}）`).join("；")}`);
        }
      }
    };
    void restore();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [generationJobId, projectId, restoreTick, selectedShot?.segmentId]);

  useEffect(() => {
    if (!projectId || !selectedShot || prompt === selectedShot.prompt) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/shots/${selectedShot.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, status: "edited" }) });
        if (!response.ok) throw new Error("保存失败");
        const data = await response.json() as { shot: ProjectShot };
        setDetail((current) => current ? { ...current, shots: current.shots.map((shot) => shot.id === data.shot.id ? data.shot : shot) } : current);
        setSaveState("已保存");
      } catch {
        setSaveState("保存失败");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, prompt, selectedShot]);

  useEffect(() => {
    if (!selectedShot) return;
    setVideoCapability(readShotVideoCapabilitySelection(parseShotGenerationPlan(selectedShot.generationPlanJson)));
    setVideoCapabilitySaveState("已保存");
  }, [selectedShot?.generationPlanJson, selectedShot?.id]);

  const saveVideoCapability = async (nextCapability: ShotVideoCapability) => {
    if (!projectId || !selectedShot) return;
    setVideoCapability(nextCapability);
    setVideoCapabilitySaveState("保存中");
    try {
      const response = await fetch(`/api/projects/${projectId}/shots/${selectedShot.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoCapability: nextCapability }),
      });
      if (!response.ok) throw new Error("保存失败");
      const data = await response.json() as { shot: ProjectShot };
      setDetail((current) => current ? { ...current, shots: current.shots.map((shot) => shot.id === data.shot.id ? data.shot : shot) } : current);
      setVideoCapabilitySaveState("已保存");
      setPlanRefreshTick((current) => current + 1);
    } catch {
      setVideoCapabilitySaveState("保存失败");
    }
  };

  const applyVideoCapabilityToSegment = async (nextCapability: ShotVideoCapability) => {
    if (!projectId || !selectedSegment || segmentShots.length <= 1) return;
    setVideoCapability(nextCapability);
    setVideoCapabilitySaveState("保存中");
    try {
      const updates = await Promise.all(segmentShots.map(async (shot) => {
        const response = await fetch(`/api/projects/${projectId}/shots/${shot.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoCapability: nextCapability }),
        });
        if (!response.ok) throw new Error("保存失败");
        return (await response.json() as { shot: ProjectShot }).shot;
      }));
      setDetail((current) => current ? {
        ...current,
        shots: current.shots.map((shot) => updates.find((item) => item.id === shot.id) ?? shot),
      } : current);
      setVideoCapabilitySaveState(`已应用到 ${segmentShots.length} 个分镜`);
      setPlanRefreshTick((current) => current + 1);
    } catch {
      setVideoCapabilitySaveState("保存失败");
    }
  };

  const openSettingsForVideoCapability = (capability: ShotVideoCapability) => {
    openSettings("video", capability);
  };

  const chooseShot = (index: number) => {
    const nextShot = shots[index];
    const changingSegment = nextShot?.segmentId !== selectedShot?.segmentId;
    setSegment(index);
    setPrompt(nextShot?.prompt ?? "");
    setSaveState("已保存");
    if (!generationJobId) {
      setGenerationState("");
      setGenerationProgress(null);
    }
    if (changingSegment) setSegmentPlan(null);
    setGenerationResultUrl(null);
    setVideoResultUrl(null);
    setPreviewSegmentVersionAssetId(null);
    setSoundRetryAvailable(false);
  };

  const chooseEpisode = (episodeId: string) => {
    const nextShots = allShots.filter((shot) => shot.episodeId === episodeId);
    setActiveEpisodeId(episodeId);
    setSegment(0);
    setPrompt(nextShots[0]?.prompt ?? "");
    setSaveState("已保存");
    setGenerationState("");
    setGenerationProgress(null);
    setSegmentPlan(null);
    setGenerationResultUrl(null);
    setVideoResultUrl(null);
    setPreviewSegmentVersionAssetId(null);
    setActiveSegmentId(null);
    setSoundRetryAvailable(false);
  };

  const submitGeneration = async (capability: ShotVideoCapabilityName) => {
    if (!projectId || !selectedShot) return;
    if (!segmentPlan || segmentPlan.missingAssets.length) {
      setGenerationState("请先补齐并锁定当前片段引用的角色、场景和道具");
      return;
    }
    if (capability !== "storyboard_frame" && capability !== "multi_subject_video" && !selectedShot.firstFrameAssetId) {
      setGenerationState("请先生成或选择分镜首帧");
      return;
    }
    if (capability !== "storyboard_frame" && capability === "first_last_frame_video") {
      const lastFrameAssetId = parseShotGenerationPlan(selectedShot.generationPlanJson).lastFrameAssetId;
      if (!lastFrameAssetId) {
        setGenerationState("首尾帧视频需要尾帧画面，请先生成尾帧");
        return;
      }
    }
    setGenerationCapability(capability);
    setGenerationScope("shot");
    setSegmentGenerationStage(null);
    setActiveSegmentId(selectedShot.segmentId);
    setGenerationState(capability === "storyboard_frame" ? "正在提交首帧生成任务…" : "正在提交视频生成任务…");
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        entityType: "shot",
        entityId: selectedShot.id,
        capability,
        payload: capability === "storyboard_frame"
          ? { prompt, aspectRatio: detail?.project.aspectRatio, stylePreset: detail?.project.stylePreset }
          : { firstFrameAssetId: selectedShot.firstFrameAssetId, prompt, duration: Math.max(1, Math.round(selectedShot.durationMs / 1_000)) },
      }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string } };
    if (!response.ok) {
      setGenerationState(data.error?.message ?? (capability === "storyboard_frame" ? "首帧任务提交失败" : "视频任务提交失败"));
      return;
    }
    if (data.job?.id) {
      setGenerationEntityId(selectedShot.id);
      setGenerationJobId(data.job.id);
    }
    setGenerationState("任务已排队，正在等待 Spark 执行…");
  };

  const submitLastFrameGeneration = async () => {
    if (!projectId || !selectedShot) return;
    if (!segmentPlan || segmentPlan.missingAssets.length) {
      setGenerationState("请先补齐并锁定当前片段引用的角色、场景和道具");
      return;
    }
    setGenerationCapability("storyboard_frame");
    setGenerationScope("shot");
    setSegmentGenerationStage(null);
    setActiveSegmentId(selectedShot.segmentId);
    setGenerationState("正在提交尾帧生成任务…");
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        entityType: "shot",
        entityId: selectedShot.id,
        capability: "storyboard_frame",
        payload: { prompt, aspectRatio: detail?.project.aspectRatio, stylePreset: detail?.project.stylePreset, frameRole: "lastFrame" },
      }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string } };
    if (!response.ok) {
      setGenerationState(data.error?.message ?? "尾帧任务提交失败");
      return;
    }
    if (data.job?.id) setGenerationJobId(data.job.id);
    setGenerationState("尾帧任务已排队，正在等待 Spark 执行…");
  };

  const submitSegmentGeneration = async (options: { confirmFrames?: boolean; regenFrames?: boolean } = {}) => {
    if (!projectId || !selectedShot?.segmentId) return;
    setGenerationScope("segment");
    setSoundRetryAvailable(false);
    setActiveSegmentId(selectedShot.segmentId);
    setGenerationJobId(null);
    setParallelGenerationJobId(null);
    setSegmentGenerationStage(null);
    setGenerationState(options.regenFrames ? "正在清空旧首帧并重新生成…" : options.confirmFrames ? "首帧已确认，正在提交视频生成…" : "正在建立片段生成任务…");
    setGenerationProgress({ overall: 1, stage: options.regenFrames ? "正在重做本片段全部首帧" : options.confirmFrames ? "正在按已确认首帧生成视频" : "正在检查片段资产和工作流" });
    if (options.regenFrames) {
      setGenerationResultUrl(null);
      setVideoResultUrl(null);
      setFramePreviewByShotId({});
      setFrameReviewOpen(true);
    }
    const response = await requestSegmentGeneration(projectId, selectedShot.segmentId, {
      force: Boolean(selectedSegment?.videoAssetId) && !options.regenFrames,
      confirmFrames: Boolean(options.confirmFrames),
      regenFrames: Boolean(options.regenFrames),
    });
    if (!response.ok || !response.data.stage) {
      setGenerationProgress(null);
      setSegmentGenerationStage(null);
      setGenerationJobId(null);
      setGenerationEntityId(null);
      setGenerationState(response.data.error?.message ?? "片段生成任务提交失败");
      return;
    }
    if (response.data.stage === "awaiting_frame_review") {
      setGenerationProgress(null);
      setSegmentGenerationStage(null);
      setFrameReviewOpen(true);
      setGenerationState(response.data.message ?? "请确认底部全部首帧后，再生成视频");
      const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (refreshed.ok) setDetail(await refreshed.json() as ProjectProductionDetail);
      return;
    }
    if (response.data.stage === "complete") {
      setVideoResultUrl(response.data.result?.assetUrl ?? null);
      setGenerationProgress({ overall: 100, stage: "片段画面已完成" });
      setGenerationState(response.data.message ?? "片段画面已完成");
      return;
    }
    if (response.data.stage === "compose" && response.data.mediaJob) {
      setGenerationState(response.data.message ?? "FFmpeg 正在合成多个分镜");
      setGenerationProgress({ overall: response.data.mediaJob.progress ?? 5, stage: "正在恢复片段合成任务" });
      setRestoreTick((current) => current + 1);
      return;
    }
    if (!response.data.job?.id) {
      setGenerationProgress(null);
      setGenerationState("片段生成没有返回可执行任务");
      return;
    }
    setSegmentGenerationStage(generationStage(response.data.stage));
    setGenerationCapability(response.data.job.capability);
    setGenerationEntityId(response.data.job.entityId ?? null);
    setGenerationJobId(response.data.job.id);
    if (response.data.stage === "first_frame") setFrameReviewOpen(true);
    if (response.data.parallelJob?.id) setParallelGenerationJobId(response.data.parallelJob.id);
    setGenerationState(response.data.message ?? "片段任务已进入 Spark 队列");
  };

  const retrySegmentSound = async () => {
    if (!projectId || !selectedShot?.segmentId || generationJobId) return;
    const segmentId = selectedShot.segmentId;
    setSoundRetryAvailable(false);
    setGenerationScope("sound");
    setActiveSegmentId(segmentId);
    setGenerationState("正在重新提交片段声音处理…");
    setGenerationProgress({ overall: 1, stage: "正在检查已完成的对白与声音轨" });
    const response = await requestSegmentSound(projectId, segmentId);
    if (!response.ok) {
      setGenerationProgress(null);
      setGenerationState(response.data.error?.message ?? "声音处理重试失败");
      setSoundRetryAvailable(true);
      return;
    }
    if (response.data.stage === "complete") {
      setGenerationProgress({ overall: 100, stage: "片段声音已完成" });
      setGenerationState(response.data.message ?? "片段声音已完成");
      if (response.data.assetUrl) setVideoResultUrl(response.data.assetUrl);
      const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (refreshed.ok) setDetail(await refreshed.json() as ProjectProductionDetail);
      return;
    }
    if (response.data.stage === "media" && response.data.mediaJob) {
      setGenerationState(response.data.message ?? "声音媒体任务已在后台执行");
      setGenerationProgress({ overall: response.data.mediaJob.progress ?? 5, stage: "FFmpeg 正在处理片段声音" });
      setRestoreTick((current) => current + 1);
      return;
    }
    if (response.data.job?.id && response.data.stage) {
      setSegmentGenerationStage(response.data.job.capability);
      setGenerationCapability(response.data.job.capability);
      setGenerationJobId(response.data.job.id);
      setGenerationProgress({ overall: 2, stage: response.data.message ?? "声音任务已进入 ComfyUI 队列" });
      return;
    }
    setGenerationProgress(null);
    setGenerationState("声音处理没有返回可执行任务");
    setSoundRetryAvailable(true);
  };

  const reviewSegmentQuality = async () => {
    if (!projectId || !selectedSegment?.id || qualityChecking) return;
    setQualityChecking(true);
    setQualityMessage("正在抽取片段时间采样图并执行连续性审片…");
    let keepPolling = false;
    try {
      const response = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/quality`, { method: "POST" });
      const data = await response.json() as { quality?: SegmentQuality; visionConfigured?: boolean; job?: { id: string; status: string; progress: number }; message?: string; error?: { message?: string; details?: { reason?: string; quality?: SegmentQuality } } };
      const quality = data.quality ?? data.error?.details?.quality;
      if (quality) setSegmentQuality(quality);
      setVisionConfigured(Boolean(data.visionConfigured));
      if (!response.ok) throw new Error(data.error?.details?.reason ?? data.error?.message ?? "片段连续性质检失败");
      setQualityMessage(data.message ?? "片段连续性质检完成");
      if (data.job && ["queued", "running"].includes(data.job.status)) {
        keepPolling = true;
        setQualityPollTick((current) => current + 1);
        return;
      }
      const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (refreshed.ok) setDetail(await refreshed.json() as ProjectProductionDetail);
    } catch (error) {
      setQualityMessage(error instanceof Error ? error.message : "片段连续性质检失败");
    } finally {
      if (!keepPolling) setQualityChecking(false);
    }
  };

  const decideSegmentQuality = async (decision: "approved" | "rejected") => {
    if (!projectId || !selectedSegment?.id || qualityDecisionPending || qualityChecking) return;
    setQualityDecisionPending(decision);
    setQualityMessage(decision === "approved" ? "正在确认当前片段版本…" : "正在标记当前版本需重做…");
    try {
      const response = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/quality`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json() as { quality?: SegmentQuality; message?: string; error?: { message?: string } };
      if (!response.ok || !data.quality) throw new Error(data.error?.message ?? "片段审片决定保存失败");
      setSegmentQuality(data.quality);
      setQualityMessage(data.message ?? "片段审片决定已保存");
      const refreshed = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (refreshed.ok) setDetail(await refreshed.json() as ProjectProductionDetail);
    } catch (error) {
      setQualityMessage(error instanceof Error ? error.message : "片段审片决定保存失败");
    } finally {
      setQualityDecisionPending(null);
    }
  };

  const selectSegmentVersion = async (version: SegmentVersion) => {
    if (!projectId || !selectedSegment || !version.resultAssetId || selectingVersionId || generationJobId) return;
    setSelectingVersionId(version.id);
    try {
      const response = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/versions/${version.id}`, { method: "PATCH" });
      const data = await response.json() as { segment?: ProjectProductionDetail["segments"][number]; assetUrl?: string; error?: { message?: string } };
      if (!response.ok || !data.segment) throw new Error(data.error?.message ?? "采用片段版本失败");
      setDetail((current) => current ? { ...current, segments: current.segments.map((item) => item.id === data.segment?.id ? data.segment : item) } : current);
      setPreviewSegmentVersionAssetId(version.resultAssetId);
      setVideoResultUrl(null);
      setGenerationState(`已采用片段版本 ${version.versionNumber}，整集合成将使用这个结果`);
    } catch (error) {
      setGenerationState(error instanceof Error ? error.message : "采用片段版本失败");
    } finally {
      setSelectingVersionId(null);
    }
  };

  const saveSegmentDirectorPrompt = async (directorPrompt: string | null) => {
    if (!projectId || !selectedSegment || savingSegmentPrompt) return;
    setSavingSegmentPrompt(true);
    setSegmentPromptSaveState("正在保存…");
    try {
      const response = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directorPrompt }),
      });
      const data = await response.json() as { segment?: ProjectProductionDetail["segments"][number]; promptSource?: "manual" | "automatic"; error?: { message?: string } };
      if (!response.ok || !data.segment) throw new Error(data.error?.message ?? "片段导演指令保存失败");
      setDetail((current) => current ? { ...current, segments: current.segments.map((item) => item.id === data.segment?.id ? data.segment : item) } : current);
      const planResponse = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/production-plan`, { cache: "no-store" });
      if (!planResponse.ok) throw new Error("导演指令已保存，但生产计划刷新失败");
      const planData = await planResponse.json() as { plan: SegmentPlan };
      setSegmentPlan(planData.plan);
      setSegmentPromptDraft(planData.plan.promptPreview);
      setSegmentPromptSaveState(planData.plan.promptSource === "manual" ? "已保存人工调整版" : "已恢复自动指令");
    } catch (error) {
      setSegmentPromptSaveState(error instanceof Error ? error.message : "片段导演指令保存失败");
    } finally {
      setSavingSegmentPrompt(false);
    }
  };

  const saveSegmentReferences = async (mode: "automatic" | "manual", keys = segmentReferenceSelectedKeys) => {
    if (!projectId || !selectedSegment || !segmentReferenceData || savingSegmentReferences) return;
    setSavingSegmentReferences(true);
    setSegmentReferenceMessage("正在保存片段参考…");
    try {
      const selections = mode === "manual" ? keys.map((key) => segmentReferenceData.options.find((option) => option.key === key)).filter((option): option is NonNullable<typeof option> => Boolean(option)).map((option) => ({ kind: option.kind, id: option.id })) : [];
      const response = await fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/references`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, selections }),
      });
      const data = await response.json() as SegmentReferenceData & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "片段参考素材保存失败");
      setSegmentReferenceData(data);
      setSegmentReferenceSelectedKeys(data.selectedKeys);
      setSegmentReferenceMessage(data.generationInvalidated ? "参考图已改，旧首帧/成片已清空，请重新点「立即生成」" : mode === "manual" ? "人工参考已保存" : "已恢复按分镜自动引用");
      setSegmentReferencePickerOpen(false);
      if (data.generationInvalidated) {
        setGenerationResultUrl(null);
        setVideoResultUrl(null);
        setPreviewSegmentVersionAssetId(null);
        setFramePreviewByShotId({});
        setFrameReviewOpen(true);
      }
      const [projectResponse, planResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/segments/${selectedSegment.id}/production-plan`, { cache: "no-store" }),
      ]);
      if (projectResponse.ok) setDetail(await projectResponse.json() as ProjectProductionDetail);
      if (planResponse.ok) setSegmentPlan((await planResponse.json() as { plan: SegmentPlan }).plan);
    } catch (error) {
      setSegmentReferenceMessage(error instanceof Error ? error.message : "片段参考素材保存失败");
    } finally {
      setSavingSegmentReferences(false);
    }
  };

  const toggleSegmentReference = (key: string) => {
    if (!segmentReferenceData || savingSegmentReferences) return;
    const next = segmentReferenceSelectedKeys.includes(key)
      ? segmentReferenceSelectedKeys.filter((item) => item !== key)
      : segmentReferenceSelectedKeys.length >= 24
        ? segmentReferenceSelectedKeys
        : [...segmentReferenceSelectedKeys, key];
    if (next === segmentReferenceSelectedKeys || (next.length === segmentReferenceSelectedKeys.length && next.every((item) => segmentReferenceSelectedKeys.includes(item)))) return;
    const hasProduced = Boolean(selectedSegment?.videoAssetId)
      || (selectedSegment ? shots.filter((shot) => shot.segmentId === selectedSegment.id).some((shot) => shot.firstFrameAssetId || shot.videoAssetId) : false);
    if (hasProduced && !window.confirm("改左侧参考会清空本片段已生成的首帧和成片。确定继续？")) return;
    setSegmentReferenceSelectedKeys(next);
    void saveSegmentReferences("manual", next);
  };

  const composeEpisode = async () => {
    if (!projectId || !resolvedEpisodeId || episodeRenderBusy) return;
    setEpisodeRenderBusy(true);
    setGenerationState("正在提交整集合成…");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${resolvedEpisodeId}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "整集合成失败");
      setGenerationState(data.message ?? "整集合成已提交，可在分集视频页查看进度");
    } catch (error) {
      setGenerationState(error instanceof Error ? error.message : "整集合成失败");
    } finally {
      setEpisodeRenderBusy(false);
    }
  };

  const segmentShots = selectedSegment ? shots.filter((shot) => shot.segmentId === selectedSegment.id) : selectedShot ? [selectedShot] : [];
  const segmentReferences: SegmentReferenceView[] = segmentReferenceData?.references ?? (detail ? buildSegmentReferences(detail, segmentShots) : []);
  const segmentShotIds = new Set(segmentShots.map((shot) => shot.id));
  const segmentDialogueLines = detail?.dialogueLines.filter((line) => segmentShotIds.has(line.shotId)).sort((a, b) => {
    const shotA = segmentShots.find((shot) => shot.id === a.shotId)?.sequence ?? 0;
    const shotB = segmentShots.find((shot) => shot.id === b.shotId)?.sequence ?? 0;
    return shotA - shotB || a.sequence - b.sequence;
  }) ?? [];
  const segmentEnvironmentPresets = detail?.audioPresets.filter((preset) => segmentShots.some((shot) => shot.environmentPresetId === preset.id)) ?? [];
  const environmentPreset = detail?.audioPresets.find((preset) => preset.id === selectedShot?.environmentPresetId) ?? null;
  const selectedSegmentVideoAsset = detail?.assets.find((asset) => asset.id === selectedSegment?.videoAssetId) ?? null;
  const selectedSegmentVersions = detail?.segmentVersions.filter((version) => version.segmentId === selectedSegment?.id).sort((a, b) => b.versionNumber - a.versionNumber) ?? [];
  const segmentNeedsRecompose = Boolean(selectedSegment && !selectedSegment.videoAssetId && selectedSegmentVersions.length && segmentShots.some((shot) => shot.videoAssetId));
  const previewSegmentVersion = selectedSegmentVersions.find((version) => version.resultAssetId === previewSegmentVersionAssetId) ?? null;
  const previewSegmentVersionAsset = detail?.assets.find((asset) => asset.id === previewSegmentVersion?.resultAssetId) ?? null;
  const generationPlan = parseShotGenerationPlan(selectedShot?.generationPlanJson);
  const shotPlanStrategy = typeof generationPlan.strategy === "string" ? generationPlan.strategy : strategyNames[readShotVideoCapabilitySelection(generationPlan)] ?? "图生视频";
  const selectedVideoRepairCapability: ShotVideoCapabilityName = segmentPlan?.steps.find((step) => step.entityId === selectedShot?.id && step.capability === "native_audio_video")?.capability === "native_audio_video"
    ? "native_audio_video"
    : readShotVideoCapabilitySelection(generationPlan);
  const selectedLastFrameAsset = generationPlan.lastFrameAssetId ? detail?.assets.find((asset) => asset.id === generationPlan.lastFrameAssetId) ?? null : null;
  const selectedVideoCapabilityLabel = shotVideoCapabilityOptions.find((option) => option.key === videoCapability)?.label ?? "图生视频";
  const selectedVideoCapabilityConfigured = segmentPlan ? !segmentPlan.missingCapabilities.includes(videoCapability) : true;
  const framesAwaitingConfirm = Boolean(
    selectedSegment
    && segmentShots.length > 0
    && segmentShots.every((shot) => Boolean(shot.firstFrameAssetId))
    && segmentShots.every((shot) => !shot.videoAssetId)
    && !generationJobId,
  );
  const segmentGenerateButtonLabel = generationJobId && generationScope === "segment"
    ? segmentGenerationStage === "first_frame" ? "正在准备首帧…" : "正在生成…"
    : framesAwaitingConfirm
      ? "确认首帧并生成视频"
      : selectedSegment?.videoAssetId
      ? `重新生成 V${selectedSegment.currentVersionNumber + 1}`
      : segmentNeedsRecompose
        ? "重新生成"
        : "立即生成";
  const segmentGenerateModeSummary = framesAwaitingConfirm
    ? `请先确认 ${segmentShots.length} 个首帧，再生成视频`
    : segmentPlan?.status === "ready"
    ? `将生成本片段 ${segmentShots.length} 个分镜的连续视频`
    : segmentPlan
      ? "生成前还需补齐条件"
      : "正在检查能否生成";
  const missingSoundCapabilities = segmentPlan?.missingSoundCapabilities ?? [];
  const shotFrameRepairBlocked = Boolean(generationJobId) || !segmentPlan || segmentPlan.missingAssets.length > 0 || segmentPlan.missingCapabilities.includes("storyboard_frame");
  const shotVideoRepairBlocked = Boolean(generationJobId) || !segmentPlan || segmentPlan.missingAssets.length > 0 || segmentPlan.missingCapabilities.includes(selectedVideoRepairCapability) || (selectedVideoRepairCapability !== "multi_subject_video" && !selectedShot?.firstFrameAssetId) || (selectedVideoRepairCapability === "first_last_frame_video" && !generationPlan.lastFrameAssetId);
  const segmentVideoBlocked = Boolean(segmentPlan && (segmentPlan.missingAssets.length > 0 || segmentPlan.missingCapabilities.length > 0 || segmentPlan.internalBlockers.length > 0));
  const openSettingsForPlanGap = () => {
    const missing = segmentPlan?.missingCapabilities[0] ?? segmentPlan?.missingSoundCapabilities?.[0];
    if (missing === "storyboard_frame" || missing === "character_image" || missing === "scene_image") return openSettings("image", missing === "scene_image" ? "image_generation" : missing);
    if (missing === "voice_synthesis" || missing === "ambient_audio" || missing === "lip_sync") return openSettings("audio", missing);
    if (missing) return openSettings("video", missing);
    openSettings("readiness");
  };
  const readinessSummary = segmentPlan
    ? segmentPlan.status === "ready"
      ? missingSoundCapabilities.length
        ? `可以生成画面；声音还可再配置 ${missingSoundCapabilities.length} 项`
        : "可以生成片段"
      : `还需补齐 ${segmentPlan.missingAssets.length} 项资产、${segmentPlan.missingCapabilities.length} 个视频能力${segmentPlan.internalBlockers.length ? `、${segmentPlan.internalBlockers.length} 项系统条件` : ""}`
    : "正在检查能否生成";
  const advancedRouteSummary = segmentPlan?.status === "ready"
    ? (missingSoundCapabilities.length ? "画面路线已就绪 · 声音可选" : "画面与声音路线已就绪")
    : segmentPlan
      ? "路线未就绪"
      : "检查中";
  const generationFailed = Boolean(generationState) && !generationJobId && !generationProgress && /失败|缺少|需要|待处理|配置|需要先配置|WORKFLOW_REQUIRED/.test(generationState);
  const episodeSegments = selectedEpisode ? detail?.segments.filter((item) => item.episodeId === selectedEpisode.id).sort((a, b) => a.sequence - b.sequence) ?? [] : [];
  const displayFrameUrl = generationResultUrl
    ?? (selectedShot ? framePreviewByShotId[selectedShot.id] : null)
    ?? selectedFrameAsset?.thumbnailUrl
    ?? (selectedShot?.firstFrameAssetId ? `/api/assets/${selectedShot.firstFrameAssetId}/content` : null);
  const displayVideoUrl = (activeSegmentId === selectedSegment?.id ? videoResultUrl : null) ?? previewSegmentVersionAsset?.thumbnailUrl ?? selectedSegmentVideoAsset?.thumbnailUrl ?? selectedVideoAsset?.thumbnailUrl ?? null;
  const shotFrameUrl = (shot: ProjectShot) => (
    framePreviewByShotId[shot.id]
    ?? detail?.assets.find((asset) => asset.id === shot.firstFrameAssetId)?.thumbnailUrl
    ?? (shot.firstFrameAssetId ? `/api/assets/${shot.firstFrameAssetId}/content` : null)
  );
  const selectSegmentShot = (shotId: string) => {
    const index = shots.findIndex((shot) => shot.id === shotId);
    if (index >= 0) chooseShot(index);
  };
  const activeShotReferenceKeys = detail && selectedShot ? shotGenerationReferenceKeys(detail, selectedShot) : new Set<string>();
  const activeShotReferenceLabel = selectedShot ? `分镜 ${String(selectedShot.sequence).padStart(2, "0")} · ${selectedShot.title}` : "";
  const shotFrameReferenceLabels = (shot: ProjectShot) => detail ? shotGenerationReferenceLabels(detail, shot) : [];
  const episodeKeys = detail && resolvedEpisodeId ? episodeReferenceKeys(detail, resolvedEpisodeId) : new Set<string>();
  const referenceOptions = segmentReferenceData?.options ?? [];
  const generateBusy = Boolean(generationJobId) || !segmentPlan;
  const runGenerate = () => {
    if (segmentPlan?.missingAssets.length) {
      onNavigate("assets");
      return;
    }
    if (segmentVideoBlocked) {
      openSettingsForPlanGap();
      return;
    }
    void submitSegmentGeneration(framesAwaitingConfirm ? { confirmFrames: true } : undefined);
  };

  if (!initialProject) {
    return <div className="editor-page"><div className="missing-project"><b>还没有选择短剧项目</b><p>请先从分集视频页面进入分镜编辑器。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></div>;
  }

  return (
    <div className="editor-page skylark-editor">
      <SegmentReferencePicker open={segmentReferencePickerOpen} data={segmentReferenceData} selectedKeys={segmentReferenceSelectedKeys} busy={savingSegmentReferences} message={segmentReferenceMessage} onClose={() => setSegmentReferencePickerOpen(false)} onToggle={(key) => setSegmentReferenceSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} onSave={() => void saveSegmentReferences("manual")} onReset={() => void saveSegmentReferences("automatic")} />
      <header className="skylark-topbar">
        <button className="editor-back" onClick={() => onNavigate("videos")}>‹</button>
        <div className="editor-title"><b>{selectedEpisode ? `第${selectedEpisode.episodeNumber}集 · ${selectedEpisode.title}` : initialProject.title}</b><span>{readinessSummary}</span></div>
        <div className="skylark-top-pills">
          <label>当前分集<select value={resolvedEpisodeId ?? ""} onChange={(event) => chooseEpisode(event.target.value)}>{detail?.episodes.map((episode) => <option key={episode.id} value={episode.id}>第 {episode.episodeNumber} 集 · {episode.title}</option>)}</select></label>
          <Pill>{detail?.project.stylePreset ?? initialProject.stylePreset}</Pill>
          <Pill>{detail?.project.aspectRatio ?? initialProject.aspectRatio}</Pill>
          <button type="button" className="top-link" onClick={() => openSettings("readiness")}>设置</button>
          <button type="button" className="skylark-primary-btn" disabled={episodeRenderBusy || !resolvedEpisodeId} onClick={() => void composeEpisode()}>{episodeRenderBusy ? "提交中…" : "合成全集"}</button>
          <span className="profile-avatar" title={user.email}>{accountAvatar}</span>
        </div>
      </header>
      {loading ? <div className="script-loading">正在读取分镜编辑器…</div> : !selectedShot ? <div className="missing-project"><b>当前项目还没有分镜</b><p>返回分集视频页面生成分镜脚本。</p><AppButton primary onClick={() => onNavigate("videos")}>返回分集视频</AppButton></div> : (
        <>
          <div className="skylark-body">
            <SegmentAssetSidebar
              scope={assetScope}
              category={assetCategory}
              options={referenceOptions}
              selectedKeys={segmentReferenceSelectedKeys}
              activeShotKeys={activeShotReferenceKeys}
              activeShotLabel={activeShotReferenceLabel}
              episodeKeys={episodeKeys}
              busy={savingSegmentReferences}
              referenceWired={Boolean(segmentPlan?.referenceWiring?.wired)}
              referenceHint={segmentPlan?.referenceWiring?.message}
              onScopeChange={setAssetScope}
              onCategoryChange={setAssetCategory}
              onToggle={toggleSegmentReference}
              onOpenAssets={() => onNavigate("assets")}
              onOpenSettings={() => openSettings("image", "storyboard_frame")}
            />
            <div className="skylark-center">
              {(generationState || generationProgress || segmentReferenceMessage) && (() => {
                const voiceBlocked = /配音还差一步|音色尚未锁定|声音生产待处理/.test(generationState);
                const bannerTone = generationFailed || voiceBlocked ? "" : generationProgress ? "ok" : segmentReferenceMessage && !generationState ? "info" : generationFailed ? "" : "ok";
                const title = generationProgress?.stage ?? (voiceBlocked ? "配音条件未齐" : generationFailed ? "需要处理" : segmentReferenceMessage && !generationState ? "参考已更新" : "生成状态");
                const detailText = [generationState, segmentReferenceMessage].filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).join(" · ");
                return <div className={`skylark-status-banner ${bannerTone}`}>
                  <div>
                    <b>{title}</b>
                    <span>{detailText}</span>
                    {generationProgress?.currentNodeTitle && <span>当前节点：{generationProgress.currentNodeTitle}{generationProgress.nodeMax ? ` · ${generationProgress.nodeValue ?? 0}/${generationProgress.nodeMax}` : ""}</span>}
                  </div>
                  <div>
                    {generationProgress ? <b>{Math.round(generationProgress.overall ?? 0)}%</b> : null}
                    {voiceBlocked ? <button type="button" className="skylark-link-btn" onClick={() => onNavigate("assets")}>去锁定音色</button> : null}
                    {soundRetryAvailable ? <AppButton onClick={() => void retrySegmentSound()}>重试声音处理</AppButton> : null}
                    {segmentReferenceMessage && !generationJobId ? <button type="button" className="skylark-link-btn" onClick={() => void submitSegmentGeneration(framesAwaitingConfirm ? { confirmFrames: true } : undefined)}>重新生成</button> : null}
                  </div>
                </div>;
              })()}
              <SegmentPromptCanvas
                segmentTitle={selectedSegment?.title ?? selectedShot.title}
                segmentSequence={selectedSegment?.sequence ?? segment + 1}
                prompt={segmentPromptDraft}
                saveState={segmentPromptSaveState}
                busy={savingSegmentPrompt}
                generating={Boolean(generationJobId)}
                generateLabel={segmentGenerateButtonLabel}
                generateDisabled={generateBusy}
                options={referenceOptions}
                selectedKeys={segmentReferenceSelectedKeys}
                advancedOpen={advancedOpen}
                onChange={(value) => { setSegmentPromptDraft(value); setSegmentPromptSaveState("有未保存修改"); }}
                onSave={() => void saveSegmentDirectorPrompt(segmentPromptDraft)}
                onCancel={() => { setSegmentPromptDraft(segmentPlan?.promptPreview ?? selectedSegment?.directorPrompt ?? ""); setSegmentPromptSaveState(segmentPlan?.promptSource === "manual" ? "已恢复上次保存" : "自动指令"); }}
                onGenerate={runGenerate}
                onToggleReference={toggleSegmentReference}
                onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
                advanced={<>
                  <p className="skylark-advanced-hint">{segmentGenerateModeSummary} · 参考 {segmentReferences.length} 项</p>
                  <SegmentShotProductionPanel
                    shot={selectedShot}
                    prompt={prompt}
                    saveState={saveState}
                    videoCapability={videoCapability}
                    videoCapabilitySaveState={videoCapabilitySaveState}
                    capabilityConfigured={selectedVideoCapabilityConfigured}
                    environmentPresetName={environmentPreset?.name ?? null}
                    lastFrameReady={Boolean(selectedLastFrameAsset)}
                    disabled={Boolean(generationJobId)}
                    segmentShotCount={segmentShots.length}
                    onPromptChange={(value) => { setPrompt(value); setSaveState("保存中"); }}
                    onVideoCapabilityChange={(value) => void saveVideoCapability(value)}
                    onApplyToAllShots={() => void applyVideoCapabilityToSegment(videoCapability)}
                    onGenerateLastFrame={() => void submitLastFrameGeneration()}
                    onOpenSettings={() => openSettingsForVideoCapability(videoCapability)}
                  />
                  <details className="segment-advanced-panel" open><summary><span>生产路线与声音</span><b>{advancedRouteSummary}</b></summary><div className="shot-production-grid">
                    <section className="generation-route-card segment-engine-card">
                      <div><span>本片段怎么生成</span><b>{segmentPlan?.productionMode === "unified_segment" ? "一次生成整段连续视频" : segmentPlan?.productionMode === "stitched_shots" ? "先逐镜生成再合成" : strategyNames[shotPlanStrategy] ?? selectedVideoCapabilityLabel}</b></div>
                      {segmentNeedsRecompose && <div className="segment-recompose-notice"><b>有分镜做过单独修复</b><span>旧片段仍在历史版本里；重新生成时会尽量复用已完成分镜。</span></div>}
                      {segmentPlan ? <>
                        <div className="production-step-list">{segmentPlan.steps.map((step) => {
                          const missingVideo = segmentPlan.missingCapabilities.includes(step.capability);
                          const missingSound = missingSoundCapabilities.includes(step.capability);
                          return <span key={step.id} className={missingVideo ? "missing" : missingSound ? "optional-missing" : "ready"}>{step.capabilityName}</span>;
                        })}</div>
                        {segmentPlan.missingAssets.length ? <p>生成前必须补齐：{segmentPlan.missingAssets.map((item) => `${item.name}（${item.reason}）`).join("、")}</p> : segmentPlan.missingCapabilities.length ? <p>当前还缺：{segmentPlan.missingCapabilityDetails.map((item) => item.name).join("、")}</p> : missingSoundCapabilities.length ? <p>画面已就绪；声音仍可选配：{(segmentPlan.missingSoundCapabilityDetails ?? []).map((item) => item.name).join("、")}</p> : <p>{segmentPlan.soundEnhancement.message}</p>}
                      </> : <p>正在检查片段所需生产能力…</p>}
                    </section>
                    <section className="segment-production-settings"><div><span>片段概况</span><b>{detail?.project.aspectRatio ?? initialProject.aspectRatio}</b></div><dl><div><dt>连续分镜</dt><dd>{segmentShots.length} 个 / {Math.round((selectedSegment?.durationMs ?? 0) / 100) / 10} 秒</dd></div><div><dt>参考图</dt><dd>{segmentReferences.length} 项，{segmentReferences.filter((item) => item.missing).length} 项缺失</dd></div><div><dt>声音</dt><dd>{segmentPlan?.soundEnhancement.status === "native" ? "随视频一起生成" : segmentDialogueLines.length ? "固定音色后期合成" : "环境声"}</dd></div><div><dt>环境声</dt><dd>{segmentEnvironmentPresets.map((preset) => preset.name).join("、") || "尚未配置"}</dd></div></dl></section>
                  </div></details>
                  <details className="segment-advanced-panel"><summary><span>对白与单镜修复</span><b>{segmentDialogueLines.length ? `${segmentDialogueLines.length} 句对白` : "无对白"}</b></summary><section className="segment-dialogue-card"><div className="segment-section-title"><div><span>全片段对白与画外音</span><b>{segmentDialogueLines.length ? `${segmentDialogueLines.length} 句` : "无对白"}</b></div><small>按分镜顺序执行，并继承角色固定音色</small></div>{segmentDialogueLines.length ? <div className="dialogue-lines">{segmentDialogueLines.map((line) => { const speaker = detail?.characters.find((character) => character.id === line.speakerCharacterId); const lineShot = segmentShots.find((shot) => shot.id === line.shotId); return <p key={line.id}><em>分镜 {lineShot?.sequence ?? "—"}</em><strong>{speaker?.canonicalName ?? (line.lineType === "narration" ? "旁白" : "画外音")}</strong><span>{line.text}</span><i>{speaker?.voiceLocked ? "固定音色" : "待锁定"}</i></p>; })}</div> : <p className="silent-shot-note">本片段没有对白；生成时仍会保留已配置的环境声。</p>}</section><div className="shot-repair-tools"><div><b>只重做当前分镜</b><span>某个镜头不满意时用；整段成片请点「立即生成」</span></div><div className="storyboard-actions"><span className="save-state-label">{saveState}</span><AppButton disabled={shotFrameRepairBlocked} onClick={() => void submitGeneration("storyboard_frame")}>{generationJobId && generationCapability === "storyboard_frame" ? "正在生成…" : selectedShot.firstFrameAssetId ? "重做当前首帧" : "生成当前首帧"}</AppButton><AppButton disabled={shotVideoRepairBlocked} onClick={() => void submitGeneration(selectedVideoRepairCapability)}>{generationJobId && generationCapability !== "storyboard_frame" ? "正在生成视频…" : selectedShot.videoAssetId ? `重做${selectedVideoCapabilityLabel}` : selectedVideoRepairCapability === "native_audio_video" ? "生成当前有声视频" : `生成${selectedVideoCapabilityLabel}`}</AppButton></div></div></details>
                  <SegmentDirectorPrompt prompt={segmentPromptDraft} productionMode={segmentPlan?.productionMode ?? null} promptSource={segmentPlan?.promptSource ?? "automatic"} saveState={segmentPromptSaveState} busy={savingSegmentPrompt || Boolean(generationJobId)} onChange={(value) => { setSegmentPromptDraft(value); setSegmentPromptSaveState("有未保存修改"); }} onSave={() => void saveSegmentDirectorPrompt(segmentPromptDraft)} onReset={() => void saveSegmentDirectorPrompt(null)} />
                  {selectedSegment && <SegmentVersionGallery versions={selectedSegmentVersions} assets={detail?.assets ?? []} currentVersionNumber={selectedSegment.currentVersionNumber} previewAssetId={previewSegmentVersionAssetId} selectingVersionId={selectingVersionId} busy={Boolean(generationJobId)} onPreview={(assetId) => { setPreviewSegmentVersionAssetId(assetId); setVideoResultUrl(null); }} onSelect={(version) => void selectSegmentVersion(version)} />}
                  {selectedSegment?.videoAssetId && <div className={`segment-quality-card ${segmentQuality?.review?.decision ?? segmentQuality?.overall?.status ?? "pending"}`}><div><span>片段审片</span><b>{segmentQuality?.review?.decision === "approved" || segmentQuality?.overall?.status === "passed" ? `已确认${segmentQuality?.overall?.score !== undefined ? ` · ${segmentQuality.overall.score} 分` : ""}` : segmentQuality?.review?.decision === "rejected" || segmentQuality?.overall?.status === "failed" ? `需重做${segmentQuality?.overall?.score !== undefined ? ` · ${segmentQuality.overall.score} 分` : ""}` : "等待确认"}</b></div><p>{(segmentQuality?.semantic?.summary ?? qualityMessage) || (visionConfigured ? "可先运行 AI 连续性检查，再由你确认是否采用当前版本。" : "AI 连续性质检是可选辅助；你可以直接审看视频并确认当前版本。")}</p><div className="segment-review-actions">{visionConfigured ? <AppButton disabled={qualityChecking || Boolean(qualityDecisionPending)} onClick={() => void reviewSegmentQuality()}>{qualityChecking ? "AI 正在检查…" : "AI 连续性检查"}</AppButton> : <AppButton onClick={() => openSettings("text")}>配置可选 AI 质检</AppButton>}<AppButton disabled={qualityChecking || Boolean(qualityDecisionPending)} onClick={() => void decideSegmentQuality("rejected")}>{qualityDecisionPending === "rejected" ? "正在保存…" : "标记需重做"}</AppButton><AppButton primary disabled={qualityChecking || Boolean(qualityDecisionPending)} onClick={() => void decideSegmentQuality("approved")}>{qualityDecisionPending === "approved" ? "正在确认…" : "确认当前版本可用"}</AppButton></div></div>}
                </>}
              />
            </div>
            <SegmentPhonePreview
              aspectRatio={detail?.project.aspectRatio ?? initialProject.aspectRatio}
              videoUrl={displayVideoUrl}
              frameUrl={displayFrameUrl}
              generating={Boolean(generationJobId)}
              generateDisabled={generateBusy}
              statusLabel={selectedSegment?.status ?? selectedShot.status}
              versionLabel={selectedSegment ? `片段 ${String(selectedSegment.sequence).padStart(2, "0")} · 版本 ${previewSegmentVersion?.versionNumber ?? (selectedSegment.currentVersionNumber || "—")}` : `分镜 ${String(segment + 1).padStart(2, "0")}`}
              frameReadyCount={segmentShots.filter((shot) => Boolean(shot.firstFrameAssetId)).length}
              frameTotal={segmentShots.length}
              awaitingFrameConfirm={framesAwaitingConfirm}
              onGenerate={runGenerate}
            />
          </div>
          <SegmentFrameReviewStrip
            open={frameReviewOpen || framesAwaitingConfirm || segmentShots.some((shot) => Boolean(shot.firstFrameAssetId) || Boolean(framePreviewByShotId[shot.id]))}
            shots={segmentShots}
            selectedShotId={selectedShot.id}
            frameUrl={shotFrameUrl}
            referenceLabels={shotFrameReferenceLabels}
            awaitingConfirm={framesAwaitingConfirm}
            busy={Boolean(generationJobId)}
            redoCurrentDisabled={shotFrameRepairBlocked}
            redoAllDisabled={Boolean(generationJobId) || !segmentPlan || segmentPlan.missingAssets.length > 0 || segmentPlan.missingCapabilities.includes("storyboard_frame")}
            onToggle={() => setFrameReviewOpen((current) => !current)}
            onSelect={selectSegmentShot}
            onRedoCurrent={() => void submitGeneration("storyboard_frame")}
            onRedoAll={() => void submitSegmentGeneration(segmentShots.some((shot) => shot.firstFrameAssetId) ? { regenFrames: true } : undefined)}
          />
          <div className="skylark-bottom-rail">
            <SegmentEpisodeRail
              segments={episodeSegments}
              shots={shots}
              versions={detail?.segmentVersions ?? []}
              activeSegmentId={selectedShot?.segmentId ?? null}
              onSelect={(segmentId) => {
                const firstShot = shots.find((shot) => shot.segmentId === segmentId);
                const index = firstShot ? shots.findIndex((shot) => shot.id === firstShot.id) : -1;
                if (index >= 0) chooseShot(index);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
