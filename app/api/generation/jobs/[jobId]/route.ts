import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../db";
import { assets, audioPresets, audioTracks, characterFormReferences, characterForms, characters, dialogueLines, episodes, generationJobs, segmentVersions, segments, shotAssetReferences, shots, shotVersions, workflowBindings } from "../../../../../db/schema";
import { downloadWorkflowOutput, getHistoryRecord, getWorkflowHistory, historyFailed, historyExecutionError, bridgeExecutionFailureMessage, inspectAudioDurationSeconds, inspectMp4DurationSeconds, loadWorkflow, resolveWorkflowOutputs, workflowQueuePresence, type WorkflowOutputContract } from "../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../lib/server/http";
import { invalidateSegmentCurrentOutput, invalidateVisualDependencyOutputs, markSegmentGenerationFailed, setCurrentSegmentVersion } from "../../../../lib/server/production-state";
import { getRequestUser } from "../../../../lib/server/request-user";
import { recoverInterruptedTextJobs } from "../../../../lib/server/text-job-recovery";
import { syncExecutionProgress } from "../../../../lib/server/workflow-progress";
import { mergeShotGenerationPlan } from "../../../../lib/shot-video-capability";
import { isCharacterVisualArchiveJob } from "../../../../lib/character-visual-generation";

type RouteContext = { params: Promise<{ jobId: string }> };

function extension(filename: string, mediaType: WorkflowOutputContract["mediaType"]) {
  const candidate = filename.match(/\.[a-z0-9]{2,6}$/i)?.[0];
  return candidate ?? ({ image: ".png", video: ".mp4", audio: ".wav", json: ".json" } as const)[mediaType];
}

function characterReferenceType(filename: string, index: number) {
  const value = filename.toLowerCase();
  if (/front|正面/.test(value)) return "front";
  if (/side|profile|侧面|侧脸/.test(value)) return "side";
  if (/back|rear|背面/.test(value)) return "back";
  if (/expression|emotion|表情/.test(value)) return "expression";
  if (/pose|action|姿势|动作/.test(value)) return "pose";
  if (/detail|close|细节|特写/.test(value)) return "detail";
  return index === 0 ? "primary" : "reference";
}

async function markRelatedSegmentGenerationFailed(job: typeof generationJobs.$inferSelect, failedAt: Date) {
  if (job.entityType === "segment") {
    await markSegmentGenerationFailed(job.entityId, failedAt);
    return;
  }
  if (job.entityType !== "shot") return;
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(job.payloadJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (payload.segmentPipeline !== true) return;
  const shot = (await getDb().select({ segmentId: shots.segmentId }).from(shots).where(eq(shots.id, job.entityId)).limit(1))[0];
  if (shot?.segmentId) await markSegmentGenerationFailed(shot.segmentId, failedAt);
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { jobId } = await context.params;
  const db = getDb();
  const rows = await db.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.ownerId, user.id))).limit(1);
  let job = rows[0];
  if (!job) return errorResponse(404, "JOB_NOT_FOUND", "生成任务不存在");
  if (["llm_script", "llm_structure", "llm_episode", "llm_analysis"].includes(job.capability) && ["queued", "running"].includes(job.status)) {
    await recoverInterruptedTextJobs(user.id, job.projectId);
    job = (await db.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.ownerId, user.id))).limit(1))[0];
    if (!job) return errorResponse(404, "JOB_NOT_FOUND", "生成任务不存在");
  }
  if (job.status === "submitting" && !job.comfyPromptId && Date.now() - job.updatedAt.getTime() > 5 * 60 * 1_000) {
    const failedAt = new Date();
    const failed = { status: "failed", errorCode: "GENERATION_SUBMIT_INTERRUPTED", errorMessage: "任务提交过程被中断，可安全重新提交", finishedAt: failedAt, updatedAt: failedAt };
    await db.update(generationJobs).set(failed).where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, "submitting")));
    await markRelatedSegmentGenerationFailed(job, failedAt);
    return json({ job: { ...job, ...failed } });
  }
  if (["llm_script", "llm_structure", "llm_episode", "llm_analysis"].includes(job.capability) && ["queued", "running"].includes(job.status) && !job.comfyPromptId) {
    const staleMs = Date.now() - job.updatedAt.getTime();
    if (staleMs > 30_000) {
      const touchedAt = new Date();
      await db.update(generationJobs).set({ updatedAt: touchedAt }).where(eq(generationJobs.id, jobId));
      job = { ...job, updatedAt: touchedAt };
    }
    return json({ job });
  }
  if (!job.comfyPromptId || !["queued", "running"].includes(job.status)) return json({ job });

  try {
    const live = await syncExecutionProgress({ ownerId: user.id, executionType: "generation_job", executionId: jobId, promptId: job.comfyPromptId });
    const history = await getWorkflowHistory(job.comfyPromptId);
    const record = getHistoryRecord(history, job.comfyPromptId);
    if (live?.snapshot.status === "failed" && (!record || historyFailed(record))) {
      const bridgeDetail = bridgeExecutionFailureMessage(live.snapshot);
      const historyDetail = record ? historyExecutionError(record) : null;
      const detail = historyDetail || bridgeDetail;
      const errorMessage = detail ? `COMFYUI_EXECUTION_FAILED:${detail}` : "ComfyUI 工作流执行失败";
      const failed = { status: "failed", errorCode: "COMFYUI_EXECUTION_FAILED", errorMessage, finishedAt: new Date(), updatedAt: new Date() };
      await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
      await markRelatedSegmentGenerationFailed(job, failed.updatedAt);
      return json({ job: { ...job, ...failed } });
    }
    if (!record) {
      const bridgeStillActive = live?.snapshot.status === "queued" || live?.snapshot.status === "running";
      const queuePresence = bridgeStillActive ? true : await workflowQueuePresence(job.comfyPromptId);
      const startedAt = job.startedAt?.getTime() ?? job.updatedAt.getTime();
      if (queuePresence === false && Date.now() - startedAt > 5 * 60 * 1_000) {
        const failed = { status: "failed", errorCode: "COMFYUI_TASK_LOST", errorMessage: "Spark 中已找不到这个任务，可能因 ComfyUI 重启或队列被清空；可安全重新生成", finishedAt: new Date(), updatedAt: new Date() };
        await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
        await markRelatedSegmentGenerationFailed(job, failed.updatedAt);
        return json({ job: { ...job, ...failed } });
      }
      if (job.status !== "running") await db.update(generationJobs).set({ status: "running", updatedAt: new Date() }).where(eq(generationJobs.id, jobId));
      return json({ job: { ...job, status: "running", progress: live?.progress ?? null } });
    }
    if (historyFailed(record)) {
      const detail = historyExecutionError(record);
      const errorMessage = detail ? `COMFYUI_EXECUTION_FAILED:${detail}` : "ComfyUI 工作流执行失败";
      const failed = { status: "failed", errorCode: "COMFYUI_EXECUTION_FAILED", errorMessage, finishedAt: new Date(), updatedAt: new Date() };
      await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
      await markRelatedSegmentGenerationFailed(job, failed.updatedAt);
      return json({ job: { ...job, ...failed } });
    }
    if (!job.workflowBindingId) throw new Error("WORKFLOW_BINDING_MISSING");
    const binding = (await db.select().from(workflowBindings).where(and(eq(workflowBindings.id, job.workflowBindingId), eq(workflowBindings.ownerId, user.id))).limit(1))[0];
    if (!binding) throw new Error("WORKFLOW_BINDING_MISSING");
    const outputContract = JSON.parse(binding.outputContractJson) as WorkflowOutputContract;
    const workflow = outputContract.collectAllImages || binding.capability === "character_image"
      ? await loadWorkflow(binding.workflowStorageKey).catch(() => null)
      : null;
    const outputs = resolveWorkflowOutputs(record, outputContract, { capability: binding.capability, workflow });
    if (!outputs.length) throw new Error(outputContract.collectAllImages ? "WORKFLOW_OUTPUT_MISSING:collectAllImages" : `WORKFLOW_OUTPUT_MISSING:${outputContract.nodeId}.${outputContract.output}`);
    if (outputs[0].outputKey && outputs[0].outputKey !== outputContract.output) {
      await db.update(workflowBindings).set({ outputContractJson: JSON.stringify({ ...outputContract, output: outputs[0].outputKey }), updatedAt: new Date() }).where(eq(workflowBindings.id, binding.id));
    }

    let episodeId: string | null = null;
    let targetSegment: typeof segments.$inferSelect | null = null;
    let targetDialogueLine: typeof dialogueLines.$inferSelect | null = null;
    let targetShot: typeof shots.$inferSelect | null = null;
    if (job.entityType === "shot") {
      const shot = (await db.select().from(shots).where(eq(shots.id, job.entityId)).limit(1))[0];
      if (shot) {
        targetShot = shot;
        const episode = (await db.select().from(episodes).where(eq(episodes.id, shot.episodeId)).limit(1))[0];
        if (episode?.projectId === job.projectId) episodeId = episode.id;
      }
    }
    if (job.entityType === "segment") {
      targetSegment = (await db.select().from(segments).where(eq(segments.id, job.entityId)).limit(1))[0] ?? null;
      if (targetSegment) {
        const episode = (await db.select().from(episodes).where(eq(episodes.id, targetSegment.episodeId)).limit(1))[0];
        if (episode?.projectId === job.projectId) episodeId = episode.id;
        else targetSegment = null;
      }
      if (!targetSegment) throw new Error("SEGMENT_NOT_FOUND");
    }
    if (job.entityType === "dialogue_line") {
      targetDialogueLine = (await db.select().from(dialogueLines).where(eq(dialogueLines.id, job.entityId)).limit(1))[0] ?? null;
      targetShot = targetDialogueLine ? (await db.select().from(shots).where(eq(shots.id, targetDialogueLine.shotId)).limit(1))[0] ?? null : null;
      const episode = targetShot ? (await db.select().from(episodes).where(eq(episodes.id, targetShot.episodeId)).limit(1))[0] : null;
      if (episode?.projectId === job.projectId) episodeId = episode.id;
      else targetDialogueLine = null;
      if (!targetDialogueLine || !targetShot || !episodeId) throw new Error("DIALOGUE_LINE_NOT_FOUND");
    }
    const targetAsset = job.entityType === "asset"
      ? (await db.select().from(assets).where(and(eq(assets.id, job.entityId), eq(assets.projectId, job.projectId))).limit(1))[0]
      : null;
    if (job.entityType === "asset" && !targetAsset) throw new Error("TARGET_ASSET_NOT_FOUND");
    const now = new Date();
    let jobPayload: Record<string, unknown> = {};
    try { jobPayload = JSON.parse(job.payloadJson) as Record<string, unknown>; } catch { jobPayload = {}; }
    const expectedVideoDurationSeconds = targetSegment
      ? targetSegment.durationMs / 1_000
      : targetShot
        ? targetShot.durationMs / 1_000
        : typeof jobPayload.duration === "number" ? jobPayload.duration : Number(jobPayload.duration) || 0;
    const assetType = job.entityType === "segment"
      ? outputContract.mediaType === "audio" ? "segment_audio" : "segment_video"
      : job.entityType === "dialogue_line" && outputContract.mediaType === "audio"
      ? "dialogue_audio"
      : isCharacterVisualArchiveJob(job.entityType, job.capability)
      ? "character"
      : targetAsset
        ? `${targetAsset.assetType}_version`
      : `${job.capability}_${outputContract.mediaType}`;
    const archived = [] as Array<{ assetId: string; assetUrl: string; filename: string; storageKey: string; durationSeconds: number | null }>;
    for (const output of outputs) {
      const downloaded = await downloadWorkflowOutput(output);
      if (downloaded.bytes.byteLength < 64) throw new Error(`WORKFLOW_OUTPUT_EMPTY:${output.filename}`);
      const durationSeconds = outputContract.mediaType === "video"
        ? inspectMp4DurationSeconds(downloaded.bytes)
        : outputContract.mediaType === "audio"
          ? inspectAudioDurationSeconds(downloaded.bytes)
          : null;
      if (outputContract.mediaType === "video" && /\.mp4$/i.test(output.filename) && (!durationSeconds || durationSeconds < 0.1)) {
        throw new Error(`WORKFLOW_VIDEO_INVALID:${durationSeconds ?? 0}s`);
      }
      if (durationSeconds && expectedVideoDurationSeconds > 0 && durationSeconds < expectedVideoDurationSeconds * 0.5) {
        throw new Error(`WORKFLOW_VIDEO_TOO_SHORT:${durationSeconds.toFixed(2)}s/${expectedVideoDurationSeconds.toFixed(2)}s`);
      }
      const assetId = crypto.randomUUID();
      const storageKey = `generated/${user.id}/${job.projectId}/${assetId}${extension(output.filename, outputContract.mediaType)}`;
      await getMediaBucket().put(storageKey, downloaded.bytes, { httpMetadata: { contentType: downloaded.contentType } });
      await db.insert(assets).values({
        id: assetId,
        projectId: job.projectId,
        episodeId,
        assetType,
        name: output.filename,
        status: "ready",
        storageKey,
        thumbnailUrl: `/api/assets/${assetId}/content`,
        metadataJson: JSON.stringify({ jobId, promptId: job.comfyPromptId, mediaType: outputContract.mediaType, durationSeconds, expectedVideoDurationSeconds: outputContract.mediaType === "video" ? expectedVideoDurationSeconds : null, sourceAssetId: targetAsset?.id ?? null, source: output, visualLocked: false, visualApprovedAt: null }),
        createdAt: now,
        updatedAt: now,
      });
      archived.push({ assetId, assetUrl: `/api/assets/${assetId}/content`, filename: output.filename, storageKey, durationSeconds });
    }
    const characterPrimaryIndex = job.capability === "character_image" && ["character", "character_form"].includes(job.entityType)
      ? Math.max(0, archived.findIndex((item, index) => characterReferenceType(item.filename, index) === "front"))
      : 0;
    let assetId = archived[characterPrimaryIndex].assetId;
    let primaryAssetUrl = archived[characterPrimaryIndex].assetUrl;
    let generatedCharacterFormId: string | null = null;
    const replaceCharacterReferencePack = async (characterFormId: string) => {
      await db.delete(characterFormReferences).where(eq(characterFormReferences.characterFormId, characterFormId));
      for (const [index, item] of archived.entries()) {
        await db.insert(characterFormReferences).values({
          id: crypto.randomUUID(),
          characterFormId,
          assetId: item.assetId,
          referenceType: characterReferenceType(item.filename, index),
          referenceOrder: index,
          isPrimary: index === characterPrimaryIndex,
          createdAt: now,
          updatedAt: now,
        });
      }
    };
    if (targetAsset) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(targetAsset.metadataJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      primaryAssetUrl = `/api/assets/${targetAsset.id}/content`;
      assetId = targetAsset.id;
      await db.update(assets).set({
        status: "ready",
        storageKey: archived[0].storageKey,
        thumbnailUrl: primaryAssetUrl,
        metadataJson: JSON.stringify({ ...metadata, latestGenerationJobId: jobId, latestVersionAssetId: archived[0].assetId, generatedAt: now.toISOString(), visualLocked: false, visualApprovedAt: null }),
        updatedAt: now,
      }).where(and(eq(assets.id, targetAsset.id), eq(assets.projectId, job.projectId)));
    }
    if (job.entityType === "shot" && job.capability === "storyboard_frame") {
      const directRepair = jobPayload.segmentPipeline !== true;
      const frameRole = jobPayload.frameRole === "lastFrame" ? "lastFrame" : "firstFrame";
      if (frameRole === "lastFrame") {
        const currentShot = (await db.select({ generationPlanJson: shots.generationPlanJson }).from(shots).where(eq(shots.id, job.entityId)).limit(1))[0];
        await db.update(shots).set({
          generationPlanJson: mergeShotGenerationPlan(currentShot?.generationPlanJson, { lastFrameAssetId: assetId }),
          updatedAt: now,
        }).where(eq(shots.id, job.entityId));
      } else {
        await db.update(shots).set({ firstFrameAssetId: assetId, ...(directRepair ? { videoAssetId: null } : {}), status: "frame_ready", updatedAt: now }).where(eq(shots.id, job.entityId));
        if (directRepair && targetShot?.segmentId) await invalidateSegmentCurrentOutput(job.projectId, targetShot.segmentId, now);
      }
    }
    if (job.entityType === "shot" && ["image_to_video", "multi_subject_video", "first_last_frame_video", "lip_sync", "native_audio_video", "image_audio_video", "text_to_video", "reference_video_character"].includes(job.capability)) {
      await db.update(shots).set({ videoAssetId: assetId, status: "video_ready", updatedAt: now }).where(eq(shots.id, job.entityId));
      const current = (await db.select({ versionNumber: shotVersions.versionNumber }).from(shotVersions).where(eq(shotVersions.shotId, job.entityId)).orderBy(desc(shotVersions.versionNumber)).limit(1))[0];
      const quality = { technical: { passed: true, durationSeconds: archived[0].durationSeconds, expectedDurationSeconds: expectedVideoDurationSeconds }, checkedAt: now.toISOString() };
      await db.insert(shotVersions).values({ id: crypto.randomUUID(), shotId: job.entityId, versionNumber: (current?.versionNumber ?? 0) + 1, prompt: typeof jobPayload.prompt === "string" ? jobPayload.prompt : "", inputsJson: job.payloadJson, resultAssetId: assetId, qualityJson: JSON.stringify(quality), status: "ready", createdAt: now });
      if (jobPayload.segmentPipeline !== true && targetShot?.segmentId) await invalidateSegmentCurrentOutput(job.projectId, targetShot.segmentId, now);
    }
    if (job.entityType === "segment" && ["image_to_video", "multi_subject_video", "first_last_frame_video", "lip_sync", "native_audio_video"].includes(job.capability) && targetSegment) {
      const current = (await db.select({ versionNumber: segmentVersions.versionNumber }).from(segmentVersions).where(eq(segmentVersions.segmentId, targetSegment.id)).orderBy(desc(segmentVersions.versionNumber)).limit(1))[0];
      const versionNumber = (current?.versionNumber ?? 0) + 1;
      const quality = { technical: { passed: true, durationSeconds: archived[0].durationSeconds, expectedDurationSeconds: expectedVideoDurationSeconds }, checkedAt: now.toISOString() };
      await db.insert(segmentVersions).values({ id: crypto.randomUUID(), segmentId: targetSegment.id, versionNumber, prompt: typeof jobPayload.prompt === "string" ? jobPayload.prompt : "", inputsJson: job.payloadJson, resultAssetId: assetId, productionMode: "unified_segment", qualityJson: JSON.stringify(quality), status: "ready", createdAt: now });
      await setCurrentSegmentVersion({
        projectId: job.projectId,
        episodeId: targetSegment.episodeId,
        segmentId: targetSegment.id,
        assetId,
        versionNumber,
        status: ["native_audio_video", "lip_sync"].includes(job.capability) ? "video_audio_ready" : "video_ready",
        updatedAt: now,
      });
    }
    if (job.entityType === "dialogue_line" && job.capability === "voice_synthesis" && targetDialogueLine && targetShot && episodeId) {
      const measuredSeconds = archived[0]?.durationSeconds ?? null;
      const lineDurationMs = measuredSeconds && measuredSeconds > 0 ? Math.max(500, Math.round(measuredSeconds * 1_000)) : null;
      await db.update(dialogueLines).set({
        audioAssetId: assetId,
        ...(lineDurationMs ? { durationMs: lineDurationMs } : {}),
        updatedAt: now,
      }).where(eq(dialogueLines.id, targetDialogueLine.id));
      const shotLines = await db.select().from(dialogueLines).where(eq(dialogueLines.shotId, targetShot.id)).orderBy(dialogueLines.sequence);
      const segmentShots = targetShot.segmentId ? await db.select().from(shots).where(eq(shots.segmentId, targetShot.segmentId)).orderBy(shots.sequence) : [targetShot];
      const shotStartMs = segmentShots.filter((shot) => shot.sequence < targetShot!.sequence).reduce((total, shot) => total + shot.durationMs, 0);
      let cursorMs = shotStartMs;
      const existingTracks = await db.select().from(audioTracks).where(and(eq(audioTracks.shotId, targetShot.id), eq(audioTracks.trackType, "dialogue")));
      for (const line of shotLines) {
        const durationMs = line.id === targetDialogueLine.id && lineDurationMs
          ? lineDurationMs
          : line.durationMs && line.durationMs > 0
            ? line.durationMs
            : Math.max(500, Math.floor(targetShot.durationMs / Math.max(1, shotLines.length)));
        const existingTrack = existingTracks.find((track) => {
          try { return (JSON.parse(track.configJson) as { dialogueLineId?: string }).dialogueLineId === line.id; } catch { return false; }
        });
        const values = {
          episodeId,
          segmentId: targetShot.segmentId,
          shotId: targetShot.id,
          trackType: "dialogue",
          assetId: line.id === targetDialogueLine.id ? assetId : line.audioAssetId,
          presetId: null,
          startMs: cursorMs,
          durationMs,
          gainCentiDb: 0,
          configJson: JSON.stringify({ dialogueLineId: line.id, lineType: line.lineType, emotion: line.emotion }),
          status: line.audioAssetId || line.id === targetDialogueLine.id ? "ready" : "draft",
          updatedAt: now,
        };
        if (existingTrack) await db.update(audioTracks).set(values).where(eq(audioTracks.id, existingTrack.id));
        else if (values.assetId) await db.insert(audioTracks).values({ id: crypto.randomUUID(), ...values, createdAt: now });
        cursorMs += durationMs;
      }
      const measuredShotDurationMs = Math.max(targetShot.durationMs, cursorMs - shotStartMs + 300);
      if (lineDurationMs || shotLines.some((line) => line.durationMs)) {
        await db.update(shots).set({ durationMs: measuredShotDurationMs, updatedAt: now }).where(eq(shots.id, targetShot.id));
        if (targetShot.segmentId) {
          const allSegmentShots = await db.select().from(shots).where(eq(shots.segmentId, targetShot.segmentId));
          await db.update(segments).set({ durationMs: allSegmentShots.reduce((total, shot) => total + (shot.id === targetShot.id ? measuredShotDurationMs : shot.durationMs), 0), updatedAt: now }).where(eq(segments.id, targetShot.segmentId));
        }
      }
    }
    if (job.entityType === "segment" && job.capability === "ambient_audio" && targetSegment && episodeId) {
      const audioPresetId = typeof jobPayload.audioPresetId === "string" ? jobPayload.audioPresetId : null;
      const preset = audioPresetId
        ? (await db.select().from(audioPresets).where(and(eq(audioPresets.id, audioPresetId), eq(audioPresets.projectId, job.projectId))).limit(1))[0] ?? null
        : null;
      if (audioPresetId && !preset) throw new Error("AUDIO_PRESET_NOT_FOUND");
      const startMs = Math.max(0, Number(jobPayload.segmentStartMs) || 0);
      const durationMs = Math.max(1_000, Number(jobPayload.segmentDurationMs) || targetSegment.durationMs);
      const existingTracks = await db.select().from(audioTracks).where(and(eq(audioTracks.segmentId, targetSegment.id), eq(audioTracks.trackType, "ambience")));
      const matchingTracks = audioPresetId ? existingTracks.filter((track) => track.presetId === audioPresetId) : existingTracks.filter((track) => !track.presetId);
      const values = {
        episodeId,
        segmentId: targetSegment.id,
        shotId: null,
        trackType: "ambience",
        assetId,
        presetId: audioPresetId,
        startMs,
        durationMs,
        gainCentiDb: -600,
        configJson: JSON.stringify({ continuousAcrossScene: true, loopToFill: true }),
        status: "ready",
        updatedAt: now,
      };
      if (matchingTracks[0]) await db.update(audioTracks).set(values).where(eq(audioTracks.id, matchingTracks[0].id));
      else await db.insert(audioTracks).values({ id: crypto.randomUUID(), ...values, createdAt: now });
      if (matchingTracks.length > 1) await db.delete(audioTracks).where(inArray(audioTracks.id, matchingTracks.slice(1).map((track) => track.id)));
      if (preset) await db.update(audioPresets).set({ assetId, updatedAt: now }).where(eq(audioPresets.id, preset.id));
    }
    if (job.entityType === "character" && (job.capability === "character_image" || job.capability === "image_generation")) {
      const character = (await db.select().from(characters).where(and(eq(characters.id, job.entityId), eq(characters.projectId, job.projectId))).limit(1))[0];
      if (!character) throw new Error("CHARACTER_NOT_FOUND");
      await db.update(characters).set({ assetId, updatedAt: now }).where(eq(characters.id, character.id));
      const forms = await db.select().from(characterForms).where(eq(characterForms.characterId, character.id)).orderBy(characterForms.createdAt);
      let baseForm = forms.find((form) => form.name === "基础形象") ?? forms[0] ?? null;
      if (!baseForm) {
        baseForm = { id: crypto.randomUUID(), characterId: character.id, name: "基础形象", description: "角色跨镜头一致性的基础视觉形态", assetId, episodeScopeJson: "[]", inheritVoice: true, createdAt: now, updatedAt: now };
        await db.insert(characterForms).values(baseForm);
      }
      generatedCharacterFormId = baseForm.id;
      await db.update(characterForms).set({ assetId, updatedAt: now }).where(eq(characterForms.id, baseForm.id));
      if (job.capability === "character_image") {
        await replaceCharacterReferencePack(baseForm.id);
      }
      await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(and(eq(shotAssetReferences.characterId, character.id), isNull(shotAssetReferences.characterFormId)));
      await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(eq(shotAssetReferences.characterFormId, baseForm.id));
    }
    if (job.entityType === "character_form" && job.capability === "image_generation") {
      const form = (await db.select().from(characterForms).where(eq(characterForms.id, job.entityId)).limit(1))[0];
      if (!form) throw new Error("CHARACTER_FORM_NOT_FOUND");
      const character = (await db.select().from(characters).where(and(eq(characters.id, form.characterId), eq(characters.projectId, job.projectId))).limit(1))[0];
      if (!character) throw new Error("CHARACTER_FORM_NOT_FOUND");
      generatedCharacterFormId = form.id;
      await db.update(characterForms).set({ assetId, updatedAt: now }).where(eq(characterForms.id, form.id));
      if (form.name === "基础形象" || form.name === "默认形象" || !character.assetId) {
        await db.update(characters).set({ assetId, updatedAt: now }).where(eq(characters.id, character.id));
        await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(and(eq(shotAssetReferences.characterId, character.id), isNull(shotAssetReferences.characterFormId)));
      }
      await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(eq(shotAssetReferences.characterFormId, form.id));
    }
    if (job.entityType === "character_form" && job.capability === "character_image") {
      const form = (await db.select().from(characterForms).where(eq(characterForms.id, job.entityId)).limit(1))[0];
      if (!form) throw new Error("CHARACTER_FORM_NOT_FOUND");
      const character = (await db.select().from(characters).where(and(eq(characters.id, form.characterId), eq(characters.projectId, job.projectId))).limit(1))[0];
      if (!character) throw new Error("CHARACTER_FORM_NOT_FOUND");
      generatedCharacterFormId = form.id;
      await db.update(characterForms).set({ assetId, updatedAt: now }).where(eq(characterForms.id, form.id));
      await replaceCharacterReferencePack(form.id);
      await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(eq(shotAssetReferences.characterFormId, form.id));
      const currentCharacterAsset = character.assetId
        ? (await db.select().from(assets).where(and(eq(assets.id, character.assetId), eq(assets.projectId, job.projectId))).limit(1))[0] ?? null
        : null;
      if (!currentCharacterAsset?.storageKey || currentCharacterAsset.status !== "ready" || form.name === "基础形象") {
        await db.update(characters).set({ assetId, updatedAt: now }).where(eq(characters.id, character.id));
        await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(and(eq(shotAssetReferences.characterId, character.id), eq(shotAssetReferences.characterFormId, form.id)));
        await db.update(shotAssetReferences).set({ assetId, updatedAt: now }).where(and(eq(shotAssetReferences.characterId, character.id), isNull(shotAssetReferences.characterFormId)));
      }
    }
    if (outputContract.mediaType === "image") {
      if (targetAsset) await invalidateVisualDependencyOutputs(job.projectId, { assetIds: [targetAsset.id] }, now);
      else if (isCharacterVisualArchiveJob(job.entityType, job.capability)) await invalidateVisualDependencyOutputs(job.projectId, { characterIds: job.entityType === "character" ? [job.entityId] : [], characterFormIds: generatedCharacterFormId ? [generatedCharacterFormId] : job.entityType === "character_form" ? [job.entityId] : [] }, now);
    }
    const result = { assetId, assetUrl: primaryAssetUrl, assets: archived, characterFormId: generatedCharacterFormId, mediaType: outputContract.mediaType, filename: archived[characterPrimaryIndex].filename };
    const completed = { status: "succeeded", resultJson: JSON.stringify(result), finishedAt: now, updatedAt: now };
    await db.update(generationJobs).set(completed).where(eq(generationJobs.id, jobId));
    return json({ job: { ...job, ...completed, result, progress: { ...(live?.progress ?? {}), overall: 100, stage: "生成结果已归档" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HISTORY_UNAVAILABLE";
    const failed = { status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() };
    await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
    await markRelatedSegmentGenerationFailed(job, failed.updatedAt);
    return json({ job: { ...job, ...failed } });
  }
}
