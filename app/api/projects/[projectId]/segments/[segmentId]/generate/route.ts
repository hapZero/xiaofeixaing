import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../../../db";
import { assets, characterFormReferences, characterForms, characters, dialogueLines, episodes, generationJobs, mediaJobs, segments, segmentVersions, shots } from "../../../../../../../db/schema";
import { composeEpisodeVideos } from "../../../../../../lib/server/media-worker";
import { inspectMp4DurationSeconds } from "../../../../../../lib/server/comfyui";
import { GenerationSubmissionError, submitGenerationJobForUser } from "../../../../../../lib/server/generation-submit";
import { errorResponse, json, readJson } from "../../../../../../lib/server/http";
import { recoverInterruptedMediaJobs } from "../../../../../../lib/server/media-job-recovery";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { buildSegmentPrompt, buildStoryboardFramePrompt, type StoryboardFrameIdentity } from "../../../../../../lib/server/segment-prompt";
import { buildCharacterReferenceCatalog, buildGenerationReferencePayload, buildShotReferenceContext, loadEffectiveSegmentReferences, referencesForShot, type EffectiveSegmentReference } from "../../../../../../lib/server/segment-references";
import { invalidateSegmentCurrentOutput, markSegmentGenerationFailed, setCurrentSegmentVersion } from "../../../../../../lib/server/production-state";
import { getRequestUser } from "../../../../../../lib/server/request-user";
import { dialogueVoiceBlockers, dialogueVoicePayload } from "../../../../../../lib/server/dialogue-voice-payload";
import { effectiveVerifiedCapabilities, getWorkflowBindingReadiness } from "../../../../../../lib/server/verified-workflows";
import { workflowCapabilities, type WorkflowCapability } from "../../../../../../lib/workflow-capabilities";
import { buildShotVideoJobPayload, measuredShotDurationMs, parseShotGenerationPlan, resolveShotVideoCapability, shotVideoGenerationBlockers } from "../../../../../../lib/shot-video-capability";
import { visualAssetMediaReady, visualAssetProductionReady } from "../../../../../../lib/visual-asset-approval";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type GenerateBody = { force?: boolean; confirmFrames?: boolean; regenFrames?: boolean };

function dimensions(aspectRatio: string) {
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1280, height: 720 };
}

function storyboardIdentitiesForShot(
  shotReferences: EffectiveSegmentReference[],
  projectCharacters: Array<{ id: string; canonicalName: string; profileJson: string }>,
  forms: Array<{ id: string; characterId: string; name: string; description: string }>,
): StoryboardFrameIdentity[] {
  const identities: StoryboardFrameIdentity[] = [];
  const seen = new Set<string>();
  for (const reference of shotReferences) {
    if (reference.referenceRole !== "character" || !reference.characterId || seen.has(reference.characterId)) continue;
    seen.add(reference.characterId);
    const character = projectCharacters.find((item) => item.id === reference.characterId);
    if (!character) continue;
    const form = reference.characterFormId
      ? forms.find((item) => item.id === reference.characterFormId)
      : forms.find((item) => item.characterId === character.id);
    identities.push({
      canonicalName: character.canonicalName,
      profileJson: character.profileJson,
      formName: form?.name ?? null,
      formDescription: form?.description ?? null,
    });
  }
  return identities;
}

function storyboardSceneName(
  shotReferences: EffectiveSegmentReference[],
  projectAssets: Array<{ id: string; name: string }>,
) {
  const sceneRef = shotReferences.find((reference) => reference.referenceRole === "scene" && reference.assetId);
  if (!sceneRef?.assetId) return null;
  return projectAssets.find((asset) => asset.id === sceneRef.assetId)?.name ?? null;
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const db = getDb();
  const segment = (await db.select().from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1))[0]?.segments;
  if (!segment) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment", entityId: segmentId, operation: "segment_shot_compose" });
  const segmentShots = await db.select().from(shots).where(eq(shots.segmentId, segmentId)).orderBy(shots.sequence);
  const shotIds = new Set(segmentShots.map((shot) => shot.id));
  const recentJobs = await db.select().from(generationJobs).where(and(eq(generationJobs.ownerId, user.id), eq(generationJobs.projectId, projectId))).orderBy(desc(generationJobs.createdAt));
  const relatedJobs = recentJobs.filter((job) => (job.entityType === "segment" && job.entityId === segmentId) || (job.entityType === "shot" && shotIds.has(job.entityId)));
  const latestComposeJob = (await db.select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment"),
    eq(mediaJobs.entityId, segmentId),
    eq(mediaJobs.operation, "segment_shot_compose"),
  )).orderBy(desc(mediaJobs.createdAt)).limit(1))[0] ?? null;
  const activeStatuses = ["submitting", "queued", "running"];
  const activeJob = relatedJobs.find((job) => activeStatuses.includes(job.status)) ?? null;
  const activeComposeJob = latestComposeJob && ["queued", "running"].includes(latestComposeJob.status) ? latestComposeJob : null;
  const stage = activeJob?.entityType === "segment" ? "segment_video" : activeJob?.capability === "storyboard_frame" ? "first_frame" : activeJob ? "shot_video" : activeComposeJob ? "compose" : null;
  const latestTerminalJob = relatedJobs.find((job) => ["succeeded", "failed"].includes(job.status)) ?? null;
  const failedJob = latestTerminalJob?.status === "failed" ? latestTerminalJob : null;
  return json({
    segment: { id: segment.id, status: segment.status, videoAssetId: segment.videoAssetId, currentVersionNumber: segment.currentVersionNumber },
    stage,
    activeJob: activeJob ? { id: activeJob.id, status: activeJob.status, capability: activeJob.capability } : null,
    mediaJob: activeComposeJob ? { id: activeComposeJob.id, status: activeComposeJob.status, operation: activeComposeJob.operation, progress: activeComposeJob.progress } : null,
    progress: {
      framesReady: segmentShots.filter((shot) => shot.firstFrameAssetId).length,
      videosReady: segmentShots.filter((shot) => shot.videoAssetId).length,
      shotTotal: segmentShots.length,
    },
    resumeRequired: !activeJob && !activeComposeJob && ["preparing", "generating", "generating_shots", "composing"].includes(segment.status),
    lastFailure: segment.status === "compose_failed" && latestComposeJob?.status === "failed"
      ? { id: latestComposeJob.id, errorCode: latestComposeJob.errorCode, errorMessage: latestComposeJob.errorMessage }
      : failedJob ? { id: failedJob.id, errorCode: failedJob.errorCode, errorMessage: failedJob.errorMessage } : null,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const body = await readJson<GenerateBody>(request);
  const segment = (await db.select().from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1))[0]?.segments;
  if (!segment) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment", entityId: segmentId, operation: "segment_shot_compose" });

  const activeCompose = (await db.select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment"),
    eq(mediaJobs.entityId, segmentId),
    eq(mediaJobs.operation, "segment_shot_compose"),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeCompose) return json({ stage: "compose", segmentId, mediaJob: activeCompose, message: "正在恢复片段合成任务" }, { status: 202 });

  const segmentShots = await db.select().from(shots).where(eq(shots.segmentId, segmentId)).orderBy(shots.sequence);
  if (!segmentShots.length) return errorResponse(409, "SEGMENT_SHOTS_REQUIRED", "片段还没有分镜指令");
  if (body?.regenFrames) {
    const clearedAt = new Date();
    for (const shot of segmentShots) {
      await db.update(shots).set({ firstFrameAssetId: null, videoAssetId: null, status: "draft", updatedAt: clearedAt }).where(eq(shots.id, shot.id));
      shot.firstFrameAssetId = null;
      shot.videoAssetId = null;
      shot.status = "draft";
    }
    await invalidateSegmentCurrentOutput(projectId, segmentId, clearedAt);
    segment.videoAssetId = null;
    segment.currentVersionNumber = 0;
  }
  const shotIds = segmentShots.map((shot) => shot.id);
  const [lines, references, readiness] = await Promise.all([
    db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)).orderBy(dialogueLines.sequence),
    loadEffectiveSegmentReferences(segmentId, shotIds, segment.referenceMode),
    getWorkflowBindingReadiness(user.id),
  ]);
  const speakerCharacterIds = [...new Set(lines.flatMap((line) => line.speakerCharacterId ? [line.speakerCharacterId] : []))];
  const referenceCharacterIds = [...new Set([
    ...speakerCharacterIds,
    ...references.flatMap((reference) => reference.characterId ? [reference.characterId] : []),
  ])];
  const [projectCharacters, projectCharacterForms] = await Promise.all([
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(characterForms).innerJoin(characters, eq(characters.id, characterForms.characterId)).where(eq(characters.projectId, projectId)),
  ]);
  const allForms = projectCharacterForms.map((row) => row.character_forms);
  const characterCatalog = buildCharacterReferenceCatalog(projectCharacters, allForms);
  const speakerCharacters = referenceCharacterIds.length
    ? projectCharacters.filter((character) => referenceCharacterIds.includes(character.id))
    : [];
  const referencedCharacterFormIds = [...new Set([
    ...references.flatMap((reference) => reference.characterFormId ? [reference.characterFormId] : []),
    ...characterCatalog.flatMap((entry) => entry.characterFormId ? [entry.characterFormId] : []),
  ])];
  const formReferenceImages = referencedCharacterFormIds.length
    ? await db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, referencedCharacterFormIds)).orderBy(characterFormReferences.referenceOrder)
    : [];
  const unresolvedReferences = references.filter((reference) => reference.required && !reference.assetId && !formReferenceImages.some((item) => item.characterFormId === reference.characterFormId));
  const requiredAssetIds = [...new Set(references.filter((reference) => reference.required).flatMap((reference) => {
    const pack = reference.characterFormId ? formReferenceImages.filter((item) => item.characterFormId === reference.characterFormId).map((item) => item.assetId) : [];
    return [...(reference.assetId ? [reference.assetId] : []), ...pack];
  }))];
  const referencedAssets = requiredAssetIds.length ? await db.select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, requiredAssetIds))) : [];
  const missingAssets = requiredAssetIds.filter((assetId) => !visualAssetMediaReady(referencedAssets.find((asset) => asset.id === assetId)));
  const unlockedReferences = references.filter((reference) => reference.required && !visualAssetProductionReady(referencedAssets.find((asset) => asset.id === reference.assetId)));
  if (missingAssets.length || unresolvedReferences.length || unlockedReferences.length) return errorResponse(409, "ASSETS_REQUIRED", "片段引用的角色、场景或道具必须先生成并锁定", { assetIds: missingAssets, referenceIds: [...new Set([...unresolvedReferences, ...unlockedReferences].map((reference) => reference.id))] });
  const shotReferenceContext = (shot: typeof segmentShots[number]) => buildShotReferenceContext({
    shot,
    dialogueLines: lines,
    characters: projectCharacters,
    assets: referencedAssets,
    characterCatalog,
  });

  const configured = effectiveVerifiedCapabilities(readiness.verifiedBindings);
  try {
    const hasDialogue = lines.some((line) => line.lineType === "dialogue" || line.lineType === "voiceover" || line.lineType === "narration");
    const unifiedCapability: WorkflowCapability | null = hasDialogue && configured.has("native_audio_video")
      ? "native_audio_video"
      : !configured.has("image_to_video") && configured.has("native_audio_video")
        ? "native_audio_video"
        : null;

    if (unifiedCapability) {
      const firstShot = segmentShots[0];
      const firstFrame = firstShot.firstFrameAssetId ? (await db.select().from(assets).where(and(eq(assets.id, firstShot.firstFrameAssetId), eq(assets.projectId, projectId))).limit(1))[0] : null;
      if (!firstFrame?.storageKey) {
        const firstReferences = referencesForShot(references, firstShot.id, shotReferenceContext(firstShot));
        const referencePayload = buildGenerationReferencePayload(firstReferences, formReferenceImages);
        const sceneIds = firstReferences.flatMap((reference) => reference.referenceRole === "scene" && reference.assetId ? [reference.assetId] : []);
        const sceneAssets = sceneIds.length ? await db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, sceneIds)) : [];
        const prompt = buildStoryboardFramePrompt({
          shotPrompt: firstShot.prompt,
          stylePreset: project.stylePreset,
          aspectRatio: project.aspectRatio,
          identities: storyboardIdentitiesForShot(firstReferences, projectCharacters, allForms),
          sceneName: storyboardSceneName(firstReferences, sceneAssets),
        });
        await db.update(segments).set({ status: "preparing", updatedAt: new Date() }).where(eq(segments.id, segmentId));
        const job = await submitGenerationJobForUser(user.id, {
          projectId,
          entityType: "shot",
          entityId: firstShot.id,
          capability: "storyboard_frame",
          payload: {
            prompt,
            aspectRatio: project.aspectRatio,
            stylePreset: project.stylePreset,
            segmentPipeline: true,
            ...referencePayload,
          },
        });
        return json({ stage: "first_frame", segmentId, job, message: "正在生成片段起始首帧；完成后请你确认，再生成整段视频" }, { status: 202 });
      }

      if (!body?.confirmFrames) {
        return json({
          stage: "awaiting_frame_review",
          segmentId,
          progress: { framesReady: 1, videosReady: 0, shotTotal: segmentShots.length },
          message: "起始首帧已就绪。请在下方确认后，再生成整段视频",
        });
      }

      const prompt = buildSegmentPrompt(segment, segmentShots, lines);
      const referencePayload = buildGenerationReferencePayload(references, formReferenceImages);
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "segment",
        entityId: segmentId,
        capability: unifiedCapability,
        payload: {
          firstFrameAssetId: firstFrame.id,
          prompt,
          duration: Math.max(1, Math.round(segment.durationMs / 1_000)),
          aspectRatio: project.aspectRatio,
          stylePreset: project.stylePreset,
          segmentShotIds: shotIds,
          soundMode: "native",
          segmentPipeline: true,
          ...referencePayload,
        },
      });
      await db.update(segments).set({ status: "generating", updatedAt: new Date() }).where(eq(segments.id, segmentId));
      return json({ stage: "segment_video", segmentId, capability: unifiedCapability, job, message: `正在生成包含 ${segmentShots.length} 个分镜的连续有声片段` }, { status: 202 });
    }

    if (!configured.has("image_to_video") && !configured.has("multi_subject_video") && !configured.has("first_last_frame_video") && !configured.has("native_audio_video") && !configured.has("image_audio_video")) {
      return errorResponse(409, "SEGMENT_VIDEO_WORKFLOW_REQUIRED", "需要先配置图生视频、首尾帧、多角色、图片+音频或原生有声视频生成方案");
    }
    if (body?.force && !["preparing", "generating_shots", "composing"].includes(segment.status)) {
      for (const shot of segmentShots) await db.update(shots).set({ videoAssetId: null, status: shot.firstFrameAssetId ? "frame_ready" : "draft", updatedAt: new Date() }).where(eq(shots.id, shot.id));
      segmentShots.forEach((shot) => { shot.videoAssetId = null; });
      await invalidateSegmentCurrentOutput(projectId, segmentId, new Date());
      segment.videoAssetId = null;
      segment.currentVersionNumber = 0;
    }
    const missingFrameShot = segmentShots.find((shot) => !shot.videoAssetId && !shot.firstFrameAssetId);
    const missingVoiceLine = hasDialogue ? lines.find((line) => !line.audioAssetId) ?? null : null;
    if (missingVoiceLine && configured.has("voice_synthesis")) {
      const voiceBlockers = dialogueVoiceBlockers(lines, speakerCharacters, { onlyLineId: missingVoiceLine.id });
      if (voiceBlockers.length) {
        return errorResponse(409, "VOICE_LOCK_REQUIRED", "请先在资产库锁定所有出场角色的音色", { characters: voiceBlockers });
      }
    }
    if (missingFrameShot && !configured.has("storyboard_frame")) return errorResponse(409, "STORYBOARD_FRAME_WORKFLOW_REQUIRED", "逐分镜生成需要先配置分镜首帧能力");
    await db.update(segments).set({ status: "generating_shots", updatedAt: new Date() }).where(eq(segments.id, segmentId));

    if (missingFrameShot) {
      const shotReferences = referencesForShot(references, missingFrameShot.id, shotReferenceContext(missingFrameShot));
      const referencePayload = buildGenerationReferencePayload(shotReferences, formReferenceImages);
      const sceneIds = shotReferences.flatMap((reference) => reference.referenceRole === "scene" && reference.assetId ? [reference.assetId] : []);
      const sceneAssets = sceneIds.length ? await db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, sceneIds)) : [];
      const prompt = buildStoryboardFramePrompt({
        shotPrompt: missingFrameShot.prompt,
        stylePreset: project.stylePreset,
        aspectRatio: project.aspectRatio,
        identities: storyboardIdentitiesForShot(shotReferences, projectCharacters, allForms),
        sceneName: storyboardSceneName(shotReferences, sceneAssets),
      });
      let parallelVoiceJob: Awaited<ReturnType<typeof submitGenerationJobForUser>> | null = null;
      if (missingVoiceLine && configured.has("voice_synthesis")) {
        const speaker = speakerCharacters.find((item) => item.id === missingVoiceLine.speakerCharacterId) ?? null;
        parallelVoiceJob = await submitGenerationJobForUser(user.id, {
          projectId,
          entityType: "dialogue_line",
          entityId: missingVoiceLine.id,
          capability: "voice_synthesis",
          payload: {
            ...dialogueVoicePayload(missingVoiceLine, speaker),
            segmentPipeline: true,
          },
        });
      }
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "shot",
        entityId: missingFrameShot.id,
        capability: "storyboard_frame",
        payload: {
          prompt,
          aspectRatio: project.aspectRatio,
          stylePreset: project.stylePreset,
          segmentPipeline: true,
          ...referencePayload,
        },
      });
      const position = segmentShots.findIndex((shot) => shot.id === missingFrameShot.id) + 1;
      return json({
        stage: "first_frame",
        segmentId,
        job,
        parallel: Boolean(parallelVoiceJob),
        parallelJob: parallelVoiceJob ? { id: parallelVoiceJob.id, capability: "voice_synthesis" } : null,
        message: parallelVoiceJob
          ? `正在并行生成第 ${position}/${segmentShots.length} 个分镜首帧与对白配音`
          : `正在生成第 ${position}/${segmentShots.length} 个分镜首帧`,
      }, { status: 202 });
    }

    const allFramesReady = segmentShots.every((shot) => Boolean(shot.firstFrameAssetId));
    const noVideosYet = segmentShots.every((shot) => !shot.videoAssetId);
    if (allFramesReady && noVideosYet && !body?.confirmFrames) {
      return json({
        stage: "awaiting_frame_review",
        segmentId,
        progress: { framesReady: segmentShots.length, videosReady: 0, shotTotal: segmentShots.length },
        message: `本片段 ${segmentShots.length} 个首帧已全部就绪。请确认底部首帧后，再生成视频`,
      });
    }

    if (missingVoiceLine && configured.has("voice_synthesis")) {
      const speaker = speakerCharacters.find((item) => item.id === missingVoiceLine.speakerCharacterId) ?? null;
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "dialogue_line",
        entityId: missingVoiceLine.id,
        capability: "voice_synthesis",
        payload: {
          ...dialogueVoicePayload(missingVoiceLine, speaker),
          segmentPipeline: true,
        },
      });
      return json({ stage: "voice_synthesis", segmentId, job, parallel: true, message: `正在生成第 ${lines.filter((line) => line.audioAssetId).length + 1}/${lines.length} 句对白（与分镜画面并行）` }, { status: 202 });
    }

    const missingVideoShot = segmentShots.find((shot) => !shot.videoAssetId);
    if (missingVideoShot) {
      const shotPlan = parseShotGenerationPlan(missingVideoShot.generationPlanJson);
      let videoCapability = resolveShotVideoCapability(shotPlan, configured);
      const shotLines = lines.filter((line) => line.shotId === missingVideoShot.id);
      let blockers = shotVideoGenerationBlockers({
        capability: videoCapability,
        plan: shotPlan,
        firstFrameAssetId: missingVideoShot.firstFrameAssetId,
        dialogueAudioReady: shotLines.length === 0 || shotLines.every((line) => Boolean(line.audioAssetId)),
      });
      // 对白配音未就绪且无法现生成时，退回图生视频，保证片段主线能继续；声音留作后续可选增强
      if (blockers.includes("需要完成对白配音") && configured.has("image_to_video")) {
        const dialogueOnly = blockers.every((item) => item === "需要完成对白配音");
        if (dialogueOnly) {
          videoCapability = "image_to_video";
          blockers = shotVideoGenerationBlockers({
            capability: videoCapability,
            plan: shotPlan,
            firstFrameAssetId: missingVideoShot.firstFrameAssetId,
            dialogueAudioReady: true,
          });
        }
      }
      if (blockers.length) {
        return errorResponse(409, "SHOT_VIDEO_INPUTS_REQUIRED", `第 ${segmentShots.findIndex((shot) => shot.id === missingVideoShot.id) + 1} 个分镜还缺少：${blockers.join("、")}`, { shotId: missingVideoShot.id, capability: videoCapability, blockers });
      }
      if (!configured.has(videoCapability)) {
        return errorResponse(409, "SEGMENT_VIDEO_WORKFLOW_REQUIRED", `需要先配置并测试“${workflowCapabilities.find((item) => item.key === videoCapability)?.name ?? videoCapability}”生成方案`);
      }
      const referencePayload = buildGenerationReferencePayload(referencesForShot(references, missingVideoShot.id, shotReferenceContext(missingVideoShot)), formReferenceImages);
      const job = await submitGenerationJobForUser(user.id, {
        projectId,
        entityType: "shot",
        entityId: missingVideoShot.id,
        capability: videoCapability,
        payload: buildShotVideoJobPayload({
          shot: missingVideoShot,
          capability: videoCapability,
          segmentPipeline: true,
          referencePayload,
          dialogueAudioAssetId: shotLines.find((line) => line.audioAssetId)?.audioAssetId ?? null,
          measuredDurationMs: measuredShotDurationMs(missingVideoShot.durationMs, shotLines),
        }),
      });
      const position = segmentShots.findIndex((shot) => shot.id === missingVideoShot.id) + 1;
      return json({ stage: "shot_video", segmentId, capability: videoCapability, job, message: `正在生成第 ${position}/${segmentShots.length} 个分镜视频` }, { status: 202 });
    }

    const videoAssetIds = segmentShots.map((shot) => shot.videoAssetId as string);
    const shotVideoAssets = await db.select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, videoAssetIds)));
    const orderedVideos = videoAssetIds.map((id) => shotVideoAssets.find((asset) => asset.id === id)).filter((asset): asset is typeof assets.$inferSelect => Boolean(asset?.storageKey));
    if (orderedVideos.length !== segmentShots.length) return errorResponse(409, "SHOT_VIDEO_FILES_MISSING", "部分分镜视频文件缺失，请重新生成对应分镜");
    const mediaJobId = crypto.randomUUID();
    const startedAt = new Date();
    await db.insert(mediaJobs).values({ id: mediaJobId, ownerId: user.id, projectId, entityType: "segment", entityId: segmentId, operation: "segment_shot_compose", status: "running", progress: 5, payloadJson: JSON.stringify({ shotAssetIds: videoAssetIds }), startedAt, createdAt: startedAt, updatedAt: startedAt });
    await db.update(segments).set({ status: "composing", updatedAt: startedAt }).where(eq(segments.id, segmentId));
    waitUntil((async () => {
      try {
      await db.update(mediaJobs).set({ progress: 15, updatedAt: new Date() }).where(eq(mediaJobs.id, mediaJobId));
      const composed = await composeEpisodeVideos({ videos: orderedVideos, ...dimensions(project.aspectRatio) });
      const durationSeconds = inspectMp4DurationSeconds(composed.bytes);
      const expectedDurationSeconds = segment.durationMs / 1_000;
      if (!durationSeconds || durationSeconds < 0.1) throw new Error(`SEGMENT_VIDEO_INVALID:${durationSeconds ?? 0}s`);
      if (durationSeconds < expectedDurationSeconds * 0.5) throw new Error(`SEGMENT_VIDEO_TOO_SHORT:${durationSeconds.toFixed(2)}s/${expectedDurationSeconds.toFixed(2)}s`);
      const assetId = crypto.randomUUID();
      const storageKey = `rendered/${user.id}/${projectId}/segments/${segmentId}/${assetId}.mp4`;
      await getMediaBucket().put(storageKey, composed.bytes, { httpMetadata: { contentType: composed.contentType } });
      const finishedAt = new Date();
      await db.insert(assets).values({ id: assetId, projectId, episodeId: segment.episodeId, assetType: "segment_video", name: `${segment.title}-逐镜合成.mp4`, status: "ready", storageKey, thumbnailUrl: `/api/assets/${assetId}/content`, metadataJson: JSON.stringify({ mediaJobId, productionMode: "stitched_shots", shotAssetIds: videoAssetIds, durationSeconds, expectedDurationSeconds }), createdAt: finishedAt, updatedAt: finishedAt });
      const latestVersion = (await db.select({ versionNumber: segmentVersions.versionNumber }).from(segmentVersions).where(eq(segmentVersions.segmentId, segmentId)).orderBy(desc(segmentVersions.versionNumber)).limit(1))[0];
      const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
      await db.insert(segmentVersions).values({ id: crypto.randomUUID(), segmentId, versionNumber, prompt: buildSegmentPrompt(segment, segmentShots, lines), inputsJson: JSON.stringify({ shotAssetIds: videoAssetIds }), resultAssetId: assetId, productionMode: "stitched_shots", qualityJson: JSON.stringify({ technical: { passed: true, durationSeconds, expectedDurationSeconds }, checkedAt: finishedAt.toISOString() }), status: "ready", createdAt: finishedAt });
      await setCurrentSegmentVersion({ projectId, episodeId: segment.episodeId, segmentId, assetId, versionNumber, status: "video_ready", updatedAt: finishedAt });
      const result = { assetId, assetUrl: `/api/assets/${assetId}/content`, versionNumber };
      await db.update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify(result), finishedAt, updatedAt: finishedAt }).where(eq(mediaJobs.id, mediaJobId));
      } catch (error) {
      const reason = error instanceof Error ? error.message : "SEGMENT_COMPOSE_FAILED";
      const failedAt = new Date();
      await db.update(mediaJobs).set({ status: "failed", errorCode: reason.split(":")[0], errorMessage: reason, finishedAt: failedAt, updatedAt: failedAt }).where(eq(mediaJobs.id, mediaJobId));
      await db.update(segments).set({ status: "compose_failed", updatedAt: failedAt }).where(eq(segments.id, segmentId));
      }
    })());
    return json({ stage: "compose", segmentId, capability: "image_to_video", mediaJob: { id: mediaJobId, status: "running", progress: 5 }, message: `正在后台合成 ${segmentShots.length} 个分镜视频，可安全离开页面` }, { status: 202 });
  } catch (error) {
    await markSegmentGenerationFailed(segmentId, new Date());
    if (error instanceof GenerationSubmissionError) return errorResponse(error.status, error.code, error.message, error.details);
    return errorResponse(500, "SEGMENT_GENERATION_FAILED", "片段生成任务提交失败");
  }
}
