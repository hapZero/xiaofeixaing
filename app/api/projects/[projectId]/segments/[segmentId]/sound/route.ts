import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../../../db";
import { assets, audioPresets, audioTracks, characters, dialogueLines, episodes, generationJobs, mediaJobs, segmentVersions, segments, shots } from "../../../../../../../db/schema";
import { GenerationSubmissionError, submitGenerationJobForUser } from "../../../../../../lib/server/generation-submit";
import { errorResponse, json } from "../../../../../../lib/server/http";
import { recoverInterruptedMediaJobs } from "../../../../../../lib/server/media-job-recovery";
import { mixAudioTracks, muxVideoAndAudio } from "../../../../../../lib/server/media-worker";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { setCurrentSegmentVersion } from "../../../../../../lib/server/production-state";
import { getRequestUser } from "../../../../../../lib/server/request-user";
import { dialogueVoiceBlockers, dialogueVoicePayload } from "../../../../../../lib/server/dialogue-voice-payload";
import { getWorkflowBindingReadiness } from "../../../../../../lib/server/verified-workflows";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type SegmentContext = Awaited<ReturnType<typeof loadSegmentContext>>;
const soundMediaOperations = ["segment_sound_mix", "segment_audio_mux"];

function timestamp(value: Date | number | string | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1_000 : value;
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}

async function loadSegmentContext(ownerId: string, projectId: string, segmentId: string) {
  const db = getDb();
  const joined = (await db.select().from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1))[0];
  if (!joined) return null;
  const segmentShots = await db.select().from(shots).where(eq(shots.segmentId, segmentId)).orderBy(shots.sequence);
  const shotIds = segmentShots.map((shot) => shot.id);
  const lines = shotIds.length ? await db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)).orderBy(dialogueLines.sequence) : [];
  const characterIds = [...new Set(lines.flatMap((line) => line.speakerCharacterId ? [line.speakerCharacterId] : []))];
  const projectCharacters = characterIds.length ? await db.select().from(characters).where(and(eq(characters.projectId, projectId), inArray(characters.id, characterIds))) : [];
  const tracks = await db.select().from(audioTracks).where(eq(audioTracks.segmentId, segmentId)).orderBy(audioTracks.startMs);
  const presetIds = [...new Set([
    ...segmentShots.flatMap((shot) => shot.environmentPresetId ? [shot.environmentPresetId] : []),
    ...tracks.flatMap((track) => track.presetId ? [track.presetId] : []),
  ])];
  const presets = presetIds.length ? await db.select().from(audioPresets).where(and(eq(audioPresets.projectId, projectId), inArray(audioPresets.id, presetIds))) : [];
  const readiness = await getWorkflowBindingReadiness(ownerId);
  return { segment: joined.segments, episode: joined.episodes, shots: segmentShots, lines, characters: projectCharacters, tracks, presets, configured: new Set(readiness.verifiedBindings.map((binding) => binding.capability)) };
}

function ambienceWindow(context: NonNullable<SegmentContext>, presetId: string) {
  let cursorMs = 0;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  for (const shot of context.shots) {
    const shotStartMs = cursorMs;
    cursorMs += shot.durationMs;
    if (shot.environmentPresetId !== presetId) continue;
    startMs = Math.min(startMs, shotStartMs);
    endMs = Math.max(endMs, cursorMs);
  }
  if (!Number.isFinite(startMs)) {
    const planned = context.tracks.filter((track) => track.trackType === "ambience" && track.presetId === presetId);
    startMs = planned.length ? Math.min(...planned.map((track) => track.startMs)) : 0;
    endMs = planned.length ? Math.max(...planned.map((track) => track.startMs + track.durationMs)) : context.segment.durationMs;
  }
  return { startMs, durationMs: Math.max(1_000, endMs - startMs) };
}

async function usePresetAssetForSegment(context: NonNullable<SegmentContext>, preset: typeof audioPresets.$inferSelect) {
  if (!preset.assetId) return;
  const db = getDb();
  const window = ambienceWindow(context, preset.id);
  const matching = context.tracks.filter((track) => track.trackType === "ambience" && track.presetId === preset.id);
  const now = new Date();
  const values = {
    episodeId: context.episode.id,
    segmentId: context.segment.id,
    shotId: null,
    trackType: "ambience",
    assetId: preset.assetId,
    presetId: preset.id,
    startMs: window.startMs,
    durationMs: window.durationMs,
    gainCentiDb: -600,
    configJson: JSON.stringify({ continuousAcrossScene: true, loopToFill: true }),
    status: "ready",
    updatedAt: now,
  };
  if (matching[0]) await db.update(audioTracks).set(values).where(eq(audioTracks.id, matching[0].id));
  else await db.insert(audioTracks).values({ id: crypto.randomUUID(), ...values, createdAt: now });
  if (matching.length > 1) await db.delete(audioTracks).where(inArray(audioTracks.id, matching.slice(1).map((track) => track.id)));
}

function soundState(context: NonNullable<SegmentContext>) {
  const hasDialogue = context.lines.length > 0;
  const missingLines = context.lines.filter((line) => !line.audioAssetId);
  const voiceBlockers = dialogueVoiceBlockers(missingLines, context.characters);
  const requestedPresets = context.presets.filter((preset) => preset.locked && (
    context.shots.some((shot) => shot.environmentPresetId === preset.id)
    || context.tracks.some((track) => track.presetId === preset.id)
  ));
  const missingAmbiencePresets = requestedPresets.filter((preset) => !context.tracks.some((track) => (
    track.trackType === "ambience" && track.presetId === preset.id && track.status === "ready" && track.assetId
  )));
  const ambienceRequested = requestedPresets.length > 0;
  const ambienceReady = ambienceRequested && missingAmbiencePresets.length === 0;
  const complete = context.segment.status === "video_audio_ready" || Boolean(context.segment.videoAssetId && !hasDialogue && !ambienceRequested);
  return { hasDialogue, missingLines, voiceBlockers, requestedPresets, missingAmbiencePresets, ambienceRequested, ambienceReady, complete };
}

async function recentSoundJobs(ownerId: string, projectId: string, context: NonNullable<SegmentContext>) {
  const recent = await getDb().select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, ownerId),
    eq(generationJobs.projectId, projectId),
  )).orderBy(desc(generationJobs.createdAt));
  const lineIds = new Set(context.lines.map((line) => line.id));
  return recent.filter((job) => (
    (job.entityType === "dialogue_line" && lineIds.has(job.entityId) && job.capability === "voice_synthesis") ||
    (job.entityType === "segment" && job.entityId === context.segment.id && ["ambient_audio", "lip_sync"].includes(job.capability))
  ));
}

async function activeSoundJob(ownerId: string, projectId: string, context: NonNullable<SegmentContext>) {
  const recent = await recentSoundJobs(ownerId, projectId, context);
  return recent.find((job) => ["submitting", "queued", "running"].includes(job.status)) ?? null;
}

async function archiveMedia(options: { ownerId: string; projectId: string; episodeId: string; segmentId: string; mediaType: "audio" | "video"; bytes: ArrayBuffer; contentType: string; operation: string }) {
  const id = crypto.randomUUID();
  const extension = options.mediaType === "audio" ? ".wav" : ".mp4";
  const storageKey = `rendered/${options.ownerId}/${options.projectId}/${id}${extension}`;
  await getMediaBucket().put(storageKey, options.bytes, { httpMetadata: { contentType: options.contentType } });
  const now = new Date();
  await getDb().insert(assets).values({
    id,
    projectId: options.projectId,
    episodeId: options.episodeId,
    assetType: options.mediaType === "audio" ? "segment_audio_mix" : "segment_video",
    name: `${options.operation}${extension}`,
    status: "ready",
    storageKey,
    thumbnailUrl: `/api/assets/${id}/content`,
    metadataJson: JSON.stringify({ source: "media_worker", operation: options.operation, segmentId: options.segmentId }),
    createdAt: now,
    updatedAt: now,
  });
  return { id, url: `/api/assets/${id}/content`, now };
}

async function startMediaJob(options: { ownerId: string; projectId: string; segmentId: string; operation: string; payload: unknown }) {
  const id = crypto.randomUUID();
  const now = new Date();
  await getDb().insert(mediaJobs).values({ id, ownerId: options.ownerId, projectId: options.projectId, entityType: "segment", entityId: options.segmentId, operation: options.operation, status: "running", progress: 5, payloadJson: JSON.stringify(options.payload), startedAt: now, createdAt: now, updatedAt: now });
  return id;
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await loadSegmentContext(user.id, projectId, segmentId);
  if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment", entityId: segmentId });
  const state = soundState(context);
  const soundJobs = await recentSoundJobs(user.id, projectId, context);
  const activeJob = soundJobs.find((job) => ["submitting", "queued", "running"].includes(job.status)) ?? null;
  const segmentMediaJobs = await getDb().select().from(mediaJobs).where(and(eq(mediaJobs.ownerId, user.id), eq(mediaJobs.entityType, "segment"), eq(mediaJobs.entityId, segmentId))).orderBy(desc(mediaJobs.createdAt));
  const activeMediaJob = segmentMediaJobs.find((job) => ["queued", "running"].includes(job.status)) ?? null;
  const latestSoundMediaJob = segmentMediaJobs.find((job) => soundMediaOperations.includes(job.operation)) ?? null;
  const mediaJob = activeMediaJob ?? latestSoundMediaJob;
  const latestGenerationTerminal = soundJobs.find((job) => ["succeeded", "failed"].includes(job.status)) ?? null;
  const latestSoundTerminal = [latestGenerationTerminal, latestSoundMediaJob]
    .filter((job): job is NonNullable<typeof job> => Boolean(job && ["succeeded", "failed"].includes(job.status)))
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] ?? null;
  const lastFailure = latestSoundTerminal?.status === "failed"
    ? { id: latestSoundTerminal.id, errorCode: latestSoundTerminal.errorCode, errorMessage: latestSoundTerminal.errorMessage }
    : null;
  return json({
    segment: { id: segmentId, status: context.segment.status, videoAssetId: context.segment.videoAssetId, audioAssetId: context.segment.audioAssetId },
    status: state.complete ? "complete" : activeJob || mediaJob?.status === "running" ? "running" : state.missingLines.length ? "voice_ready" : context.segment.videoAssetId ? "ready_to_continue" : state.hasDialogue ? "voice_in_progress" : "waiting_video",
    mode: state.complete ? "native_or_lip_synced" : state.hasDialogue ? "separate_voice" : state.ambienceRequested ? "ambience_only" : "visual_only",
    activeJob: activeJob ? { id: activeJob.id, capability: activeJob.capability, status: activeJob.status } : null,
    mediaJob: mediaJob ? { id: mediaJob.id, operation: mediaJob.operation, status: mediaJob.status, progress: mediaJob.progress, errorMessage: mediaJob.errorMessage } : null,
    lastFailure,
    progress: { dialogueReady: context.lines.length - state.missingLines.length, dialogueTotal: context.lines.length, ambienceRequested: state.ambienceRequested, ambienceReady: state.ambienceReady },
    blockers: state.voiceBlockers,
    resumeRequired: !state.complete && (Boolean(context.segment.videoAssetId) || state.missingLines.length > 0) && !activeJob && !activeMediaJob && !lastFailure,
  });
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  let context = await loadSegmentContext(user.id, projectId, segmentId);
  if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment", entityId: segmentId });
  let state = soundState(context);
  if (!context.segment.videoAssetId && state.missingLines.length === 0 && !state.hasDialogue && !state.ambienceRequested) {
    return errorResponse(409, "SEGMENT_VIDEO_REQUIRED", "请先完成片段视频生成");
  }
  const postVideoPhase = Boolean(context.segment.videoAssetId);
  if (!postVideoPhase && state.missingLines.length === 0 && state.hasDialogue) {
    return json({ stage: "voice_ready", segmentId, message: "对白配音已完成，等待分镜画面与镜头视频继续" });
  }
  if (postVideoPhase && state.complete) return json({ stage: "complete", segmentId, message: "片段声音与画面已经完成", assetId: context.segment.videoAssetId });
  if (state.voiceBlockers.length) return errorResponse(409, "VOICE_LOCK_REQUIRED", "请先在资产库锁定所有出场角色的音色", { characters: state.voiceBlockers });

  const activeJob = await activeSoundJob(user.id, projectId, context);
  if (activeJob) return json({ stage: activeJob.capability, segmentId, job: { id: activeJob.id, capability: activeJob.capability }, message: "已恢复正在执行的声音任务" }, { status: 202 });
  const activeMediaJob = (await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment"),
    eq(mediaJobs.entityId, segmentId),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).orderBy(desc(mediaJobs.createdAt)).limit(1))[0];
  if (activeMediaJob) return json({ stage: "media", segmentId, mediaJob: activeMediaJob, message: "正在恢复片段声音合成任务" }, { status: 202 });

  try {
    const nextLine = state.missingLines[0];
    if (nextLine) {
      if (!context.configured.has("voice_synthesis")) return errorResponse(409, "VOICE_WORKFLOW_REQUIRED", "当前视频方案不带原生声音，需要配置固定角色音色生成能力");
      const speaker = context.characters.find((item) => item.id === nextLine.speakerCharacterId) ?? null;
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "dialogue_line",
        entityId: nextLine.id,
        capability: "voice_synthesis",
        payload: dialogueVoicePayload(nextLine, speaker),
      });
      return json({ stage: "voice_synthesis", segmentId, job, message: `正在生成第 ${context.lines.length - state.missingLines.length + 1}/${context.lines.length} 句固定音色对白` }, { status: 202 });
    }

    const ambiencePreset = state.missingAmbiencePresets[0] ?? null;
    if (ambiencePreset?.assetId) {
      await usePresetAssetForSegment(context, ambiencePreset);
      context = await loadSegmentContext(user.id, projectId, segmentId);
      if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
      state = soundState(context);
    }
    const missingAmbiencePreset = state.missingAmbiencePresets[0] ?? null;
    if (missingAmbiencePreset && !context.configured.has("ambient_audio")) {
      return errorResponse(409, "AMBIENT_AUDIO_WORKFLOW_REQUIRED", "当前场景已锁定环境声音场，需要配置环境声音生成能力");
    }
    if (missingAmbiencePreset && context.configured.has("ambient_audio")) {
      const window = ambienceWindow(context, missingAmbiencePreset.id);
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "segment",
        entityId: segmentId,
        capability: "ambient_audio",
        payload: {
          prompt: missingAmbiencePreset.description || missingAmbiencePreset.name,
          duration: Math.max(30, Math.ceil(window.durationMs / 1_000)),
          audioPresetId: missingAmbiencePreset.id,
          segmentStartMs: window.startMs,
          segmentDurationMs: window.durationMs,
          referenceAudioAssetId: missingAmbiencePreset.assetId,
        },
      });
      return json({ stage: "ambient_audio", segmentId, job, message: "正在生成可跨片段复用的场景声音基线" }, { status: 202 });
    }

    let mixedAsset: typeof assets.$inferSelect | null = null;
    if (context.segment.audioAssetId) mixedAsset = (await getDb().select().from(assets).where(and(eq(assets.id, context.segment.audioAssetId), eq(assets.projectId, projectId))).limit(1))[0] ?? null;
    if (!mixedAsset) {
      if (!postVideoPhase) return json({ stage: "voice_ready", segmentId, message: "对白已生成，等待片段视频完成后混合音轨" });
      const readyTracks = context.tracks.filter((track) => track.status === "ready" && track.assetId).filter((track, index, all) => (
        track.trackType !== "ambience" || all.findIndex((candidate) => candidate.trackType === "ambience" && candidate.presetId === track.presetId) === index
      ));
      const trackAssetIds = [...new Set(readyTracks.map((track) => track.assetId as string))];
      const trackAssets = trackAssetIds.length ? await getDb().select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, trackAssetIds))) : [];
      if (!readyTracks.length) return json({ stage: "complete", segmentId, message: "本片段没有需要补充的对白或环境声音", assetId: context.segment.videoAssetId });
      const mediaJobId = await startMediaJob({ ownerId: user.id, projectId, segmentId, operation: "segment_sound_mix", payload: { trackIds: readyTracks.map((track) => track.id), durationMs: context.segment.durationMs } });
      waitUntil((async () => {
        try {
        await getDb().update(mediaJobs).set({ progress: 15, updatedAt: new Date() }).where(eq(mediaJobs.id, mediaJobId));
        const mixed = await mixAudioTracks({
          durationMs: context.segment.durationMs,
          tracks: readyTracks.flatMap((track) => {
            const asset = trackAssets.find((item) => item.id === track.assetId);
            return asset ? [{
              asset,
              startMs: track.startMs,
              gainDb: track.gainCentiDb / 100,
              loop: track.trackType === "ambience",
              durationMs: track.trackType === "ambience" ? track.durationMs : undefined,
            }] : [];
          }),
        });
        const archived = await archiveMedia({ ownerId: user.id, projectId, episodeId: context.episode.id, segmentId, mediaType: "audio", bytes: mixed.bytes, contentType: mixed.contentType, operation: "segment-sound-mix" });
        await getDb().update(segments).set({ audioAssetId: archived.id, status: "sound_ready", updatedAt: archived.now }).where(eq(segments.id, segmentId));
        await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify({ assetId: archived.id, assetUrl: archived.url }), finishedAt: archived.now, updatedAt: archived.now }).where(eq(mediaJobs.id, mediaJobId));
        } catch (error) {
        const message = error instanceof Error ? error.message : "MEDIA_WORKER_FAILED";
        await getDb().update(mediaJobs).set({ status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(mediaJobs.id, mediaJobId));
        }
      })());
      return json({ stage: "media", segmentId, mediaJob: { id: mediaJobId, status: "running", progress: 5 }, message: "正在后台混合对白与环境声，可安全离开页面" }, { status: 202 });
    }
    if (!mixedAsset) return errorResponse(500, "SEGMENT_AUDIO_MISSING", "片段声音文件归档失败");

    if (state.hasDialogue) {
      if (!context.configured.has("lip_sync")) return errorResponse(409, "LIP_SYNC_WORKFLOW_REQUIRED", "对白已经生成，还需要配置口型同步能力");
      const job = await submitGenerationJobForUser(user.id, { projectId, entityType: "segment", entityId: segmentId, capability: "lip_sync", payload: { videoAssetId: context.segment.videoAssetId, audioAssetId: mixedAsset.id } });
      return json({ stage: "lip_sync", segmentId, job, message: "固定音色对白已混合，正在生成最终口型视频" }, { status: 202 });
    }

    const sourceVideoAssetId = context.segment.videoAssetId;
    if (!sourceVideoAssetId) return errorResponse(409, "SEGMENT_VIDEO_REQUIRED", "请先完成片段视频生成");
    const videoAsset = (await getDb().select().from(assets).where(and(eq(assets.id, sourceVideoAssetId), eq(assets.projectId, projectId))).limit(1))[0];
    if (!videoAsset) return errorResponse(409, "SEGMENT_VIDEO_ASSET_MISSING", "片段视频文件不存在");
    const muxJobId = await startMediaJob({ ownerId: user.id, projectId, segmentId, operation: "segment_audio_mux", payload: { videoAssetId: videoAsset.id, audioAssetId: mixedAsset.id } });
    waitUntil((async () => {
      try {
      await getDb().update(mediaJobs).set({ progress: 15, updatedAt: new Date() }).where(eq(mediaJobs.id, muxJobId));
      const muxed = await muxVideoAndAudio({ video: videoAsset, audio: mixedAsset });
      const archived = await archiveMedia({ ownerId: user.id, projectId, episodeId: context.episode.id, segmentId, mediaType: "video", bytes: muxed.bytes, contentType: muxed.contentType, operation: "segment-audio-mux" });
      const current = (await getDb().select({ versionNumber: segmentVersions.versionNumber }).from(segmentVersions).where(eq(segmentVersions.segmentId, segmentId)).orderBy(desc(segmentVersions.versionNumber)).limit(1))[0];
      const versionNumber = (current?.versionNumber ?? 0) + 1;
      await getDb().insert(segmentVersions).values({ id: crypto.randomUUID(), segmentId, versionNumber, prompt: "环境声音场合入", inputsJson: JSON.stringify({ videoAssetId: videoAsset.id, audioAssetId: mixedAsset.id }), resultAssetId: archived.id, productionMode: "visual_plus_audio_mux", qualityJson: "{}", status: "ready", createdAt: archived.now });
      await setCurrentSegmentVersion({ projectId, episodeId: context.episode.id, segmentId, assetId: archived.id, versionNumber, status: "video_audio_ready", updatedAt: archived.now });
      await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify({ assetId: archived.id, assetUrl: archived.url }), finishedAt: archived.now, updatedAt: archived.now }).where(eq(mediaJobs.id, muxJobId));
      } catch (error) {
      const message = error instanceof Error ? error.message : "MEDIA_WORKER_FAILED";
      await getDb().update(mediaJobs).set({ status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(mediaJobs.id, muxJobId));
      }
    })());
    return json({ stage: "media", segmentId, mediaJob: { id: muxJobId, status: "running", progress: 5 }, message: "正在后台合入片段声音，可安全离开页面" }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationSubmissionError) return errorResponse(error.status, error.code, error.message, error.details);
    const reason = error instanceof Error ? error.message : "SEGMENT_SOUND_FAILED";
    return errorResponse(500, "SEGMENT_SOUND_FAILED", "片段声音任务提交失败", { reason });
  }
}
