import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { assets, audioPresets, characterFormReferences, characters, dialogueLines, episodes, segments, shots } from "../../../../../../../db/schema";
import { errorResponse, json } from "../../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../../lib/server/request-user";
import { buildSegmentPrompt } from "../../../../../../lib/server/segment-prompt";
import { buildGenerationReferencePayload, loadEffectiveSegmentReferences } from "../../../../../../lib/server/segment-references";
import { effectiveVerifiedCapabilities, getWorkflowBindingReadiness } from "../../../../../../lib/server/verified-workflows";
import { bindingCapabilityKey, workflowCapabilities, type WorkflowCapability } from "../../../../../../lib/workflow-capabilities";
import { bindingAcceptsStoryboardReferences, resolveWorkflowBinding } from "../../../../../../lib/workflow-routing";
import { parseShotGenerationPlan, resolveShotVideoCapability, shotVideoGenerationBlockers } from "../../../../../../lib/shot-video-capability";
import { visualAssetMediaReady, visualAssetProductionReady } from "../../../../../../lib/visual-asset-approval";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type PlanStep = {
  id: string;
  scope: "segment" | "shot";
  entityId: string;
  capability: WorkflowCapability | "segment_compose";
  capabilityName: string;
  dependsOn: string[];
  purpose: string;
};

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

  const [segmentShots, readiness] = await Promise.all([
    db.select().from(shots).where(eq(shots.segmentId, segmentId)).orderBy(shots.sequence),
    getWorkflowBindingReadiness(user.id),
  ]);
  const shotIds = segmentShots.map((shot) => shot.id);
  const [references, segmentDialogueLines] = await Promise.all([
    loadEffectiveSegmentReferences(segmentId, shotIds, segment.referenceMode),
    shotIds.length ? db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)) : Promise.resolve([]),
  ]);
  const environmentPresetIds = [...new Set(segmentShots.flatMap((shot) => shot.environmentPresetId ? [shot.environmentPresetId] : []))];
  const environmentPresets = environmentPresetIds.length ? await db.select().from(audioPresets).where(inArray(audioPresets.id, environmentPresetIds)) : [];
  const ambienceRequired = environmentPresets.some((preset) => preset.locked);
  const characterIds = [...new Set(references.flatMap((reference) => reference.characterId ? [reference.characterId] : []))];
  const characterFormIds = [...new Set(references.flatMap((reference) => reference.characterFormId ? [reference.characterFormId] : []))];
  const [referencedCharacters, formReferenceImages] = await Promise.all([
    characterIds.length ? db.select().from(characters).where(inArray(characters.id, characterIds)) : Promise.resolve([]),
    characterFormIds.length ? db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, characterFormIds)) : Promise.resolve([]),
  ]);
  const referencedAssetIds = [...new Set([
    ...references.flatMap((reference) => reference.assetId ? [reference.assetId] : []),
    ...referencedCharacters.flatMap((character) => character.assetId ? [character.assetId] : []),
    ...formReferenceImages.map((reference) => reference.assetId),
  ])];
  const referencedAssets = referencedAssetIds.length ? await db.select().from(assets).where(inArray(assets.id, referencedAssetIds)) : [];
  const assetMediaReady = (assetId: string | null | undefined) => {
    const asset = referencedAssets.find((item) => item.id === assetId);
    return visualAssetMediaReady(asset);
  };
  const assetProductionReady = (assetId: string | null | undefined) => {
    const asset = referencedAssets.find((item) => item.id === assetId);
    return visualAssetProductionReady(asset);
  };
  const missingAssets = references.flatMap((reference) => {
    if (!reference.required) return [];
    if (reference.referenceRole === "character") {
      const character = referencedCharacters.find((item) => item.id === reference.characterId);
      const pack = reference.characterFormId ? formReferenceImages.filter((item) => item.characterFormId === reference.characterFormId) : [];
      const primaryAssetId = reference.assetId ?? character?.assetId;
      const ready = assetProductionReady(primaryAssetId) && (!pack.length || pack.every((item) => assetMediaReady(item.assetId)));
      return ready ? [] : [{ type: reference.characterFormId ? "character_form" : "character", id: reference.characterFormId ?? reference.characterId ?? reference.id, name: character?.canonicalName ?? "角色", reason: reference.characterFormId ? "当前片段引用的角色形态尚未锁定，或参考图包文件不完整" : "角色标准图尚未生成并锁定" }];
    }
    if (reference.referenceRole === "scene") {
      const asset = referencedAssets.find((item) => item.id === reference.assetId);
      return assetProductionReady(reference.assetId) ? [] : [{ type: "scene", id: reference.assetId ?? reference.id, name: asset?.name ?? "场景", reason: "场景标准图尚未生成并锁定" }];
    }
    if (reference.referenceRole === "prop") {
      const asset = referencedAssets.find((item) => item.id === reference.assetId);
      return assetProductionReady(reference.assetId) ? [] : [{ type: "prop", id: reference.assetId ?? reference.id, name: asset?.name ?? "道具", reason: "道具标准图尚未生成并锁定" }];
    }
    return [];
  }).filter((item, index, all) => all.findIndex((candidate) => `${candidate.type}:${candidate.id}` === `${item.type}:${item.id}`) === index);
  const configured = effectiveVerifiedCapabilities(readiness.verifiedBindings);
  const missingCapabilities: WorkflowCapability[] = [];
  const missingSoundCapabilities: WorkflowCapability[] = [];
  const steps: PlanStep[] = [];
  const hasDialogue = segmentDialogueLines.some((line) => ["dialogue", "voiceover", "narration"].includes(line.lineType));
  const unifiedCapability: WorkflowCapability | null = hasDialogue && configured.has("native_audio_video")
    ? "native_audio_video"
    : !configured.has("image_to_video") && configured.has("native_audio_video")
        ? "native_audio_video"
        : null;
  const productionMode = unifiedCapability ? "unified_segment" : "stitched_shots";
  let dependency: string[] = [];
  let parallelVoiceStepId: string | null = null;
  if (unifiedCapability) {
    const firstShot = segmentShots[0] ?? null;
    if (firstShot && !firstShot.firstFrameAssetId) {
      const definition = workflowCapabilities.find((item) => item.key === "storyboard_frame");
      const id = `${firstShot.id}:storyboard_frame`;
      steps.push({ id, scope: "shot", entityId: firstShot.id, capability: "storyboard_frame", capabilityName: definition?.name ?? "分镜首帧", dependsOn: [], purpose: "先生成片段起始画面，作为连续视频构图锚点" });
      dependency = [id];
    }
    const definition = workflowCapabilities.find((item) => item.key === unifiedCapability);
    const videoId = `${segment.id}:${unifiedCapability}`;
    steps.push({ id: videoId, scope: "segment", entityId: segment.id, capability: unifiedCapability, capabilityName: definition?.name ?? unifiedCapability, dependsOn: dependency, purpose: `一次提交 ${segmentShots.length} 个分镜的完整导演指令，生成连续片段视频` });
    dependency = [videoId];
  } else if (configured.has("image_to_video") || configured.has("multi_subject_video") || configured.has("first_last_frame_video") || configured.has("image_audio_video")) {
    const frameDefinition = workflowCapabilities.find((item) => item.key === "storyboard_frame");
    const videoStepIds: string[] = [];
    const voiceId = hasDialogue ? `${segment.id}:voice_synthesis` : null;
    parallelVoiceStepId = voiceId;
    if (voiceId) {
      const voiceDefinition = workflowCapabilities.find((item) => item.key === "voice_synthesis");
      steps.push({ id: voiceId, scope: "segment", entityId: segment.id, capability: "voice_synthesis", capabilityName: voiceDefinition?.name ?? "对白 TTS", dependsOn: [], purpose: "与分镜画面并行生成对白音频；实测时长将反推镜头时长" });
    }
    for (const [index, shot] of segmentShots.entries()) {
      const shotPlan = parseShotGenerationPlan(shot.generationPlanJson);
      const videoCapability = resolveShotVideoCapability(shotPlan, configured);
      const videoDefinition = workflowCapabilities.find((item) => item.key === videoCapability);
      const frameId = `${shot.id}:storyboard_frame`;
      const shotLines = segmentDialogueLines.filter((line) => line.shotId === shot.id);
      const shotHasDialogue = shotLines.some((line) => ["dialogue", "voiceover", "narration"].includes(line.lineType));
      if (!shot.firstFrameAssetId) steps.push({ id: frameId, scope: "shot", entityId: shot.id, capability: "storyboard_frame", capabilityName: frameDefinition?.name ?? "分镜首帧", dependsOn: [], purpose: `生成第 ${index + 1} 个分镜的构图与角色一致性锚点` });
      const videoId = `${shot.id}:${videoCapability}`;
      const blockers = shotVideoGenerationBlockers({
        capability: videoCapability,
        plan: shotPlan,
        firstFrameAssetId: shot.firstFrameAssetId,
        dialogueAudioReady: !shotHasDialogue || shotLines.every((line) => Boolean(line.audioAssetId)),
      });
      const videoDependsOn = [
        ...(shot.firstFrameAssetId ? [] : [frameId]),
        ...(voiceId && shotHasDialogue ? [voiceId] : []),
      ];
      steps.push({
        id: videoId,
        scope: "shot",
        entityId: shot.id,
        capability: videoCapability,
        capabilityName: videoDefinition?.name ?? videoCapability,
        dependsOn: videoDependsOn,
        purpose: blockers.length
          ? `第 ${index + 1} 个分镜还缺少：${blockers.join("、")}`
          : videoCapability === "image_audio_video"
            ? `使用对白音频与首帧生成第 ${index + 1} 个分镜口型视频`
            : videoCapability === "first_last_frame_video"
              ? `使用首尾帧控制第 ${index + 1} 个分镜的动作起止`
              : videoCapability === "multi_subject_video"
                ? `使用多角色参考生成第 ${index + 1} 个分镜`
                : `根据第 ${index + 1} 个分镜的首帧、动作和时长生成独立镜头视频`,
      });
      videoStepIds.push(videoId);
      if (!configured.has(videoCapability) && !configured.has(bindingCapabilityKey(videoCapability)) && !missingCapabilities.includes(videoCapability)) missingCapabilities.push(videoCapability);
      if (videoCapability === "first_last_frame_video" && !shotPlan.lastFrameAssetId) {
        missingAssets.push({ type: "last_frame", id: shot.id, name: `分镜 ${index + 1}`, reason: "已选择首尾帧视频，但尚未设置尾帧画面" });
      }
    }
    const composeId = `${segment.id}:segment_compose`;
    steps.push({ id: composeId, scope: "segment", entityId: segment.id, capability: "segment_compose", capabilityName: "片段合成", dependsOn: videoStepIds, purpose: `按导演顺序拼接 ${segmentShots.length} 个分镜视频，统一尺寸、帧率和音轨` });
    dependency = [composeId];
  }
  const enhancementDependencies: string[] = [...dependency];
  if (ambienceRequired && unifiedCapability !== "native_audio_video") {
    const ambienceDefinition = workflowCapabilities.find((item) => item.key === "ambient_audio");
    const ambienceId = `${segment.id}:ambient_audio`;
    steps.push({ id: ambienceId, scope: "segment", entityId: segment.id, capability: "ambient_audio", capabilityName: ambienceDefinition?.name ?? "环境声音场", dependsOn: dependency, purpose: "按项目锁定的场景声音设定生成覆盖整个片段的连续环境底声" });
    enhancementDependencies.push(ambienceId);
  }
  if (hasDialogue && unifiedCapability !== "native_audio_video") {
    const lipDefinition = workflowCapabilities.find((item) => item.key === "lip_sync");
    steps.push({ id: `${segment.id}:lip_sync`, scope: "segment", entityId: segment.id, capability: "lip_sync", capabilityName: lipDefinition?.name ?? "口型同步", dependsOn: enhancementDependencies, purpose: "把对白和环境声混音后，与片段视频合成最终口型视频" });
  } else if (ambienceRequired && unifiedCapability !== "native_audio_video") {
    steps.push({ id: `${segment.id}:audio_mux`, scope: "segment", entityId: segment.id, capability: "segment_compose", capabilityName: "声音合入", dependsOn: enhancementDependencies, purpose: "把连续环境声音场合入片段视频" });
  }
  if (segmentShots.some((shot) => !shot.firstFrameAssetId) && !configured.has("storyboard_frame")) missingCapabilities.push("storyboard_frame");
  if (!unifiedCapability && !configured.has("image_to_video") && !configured.has("multi_subject_video") && !configured.has("first_last_frame_video")) missingCapabilities.push("image_to_video");
  if (hasDialogue && unifiedCapability !== "native_audio_video") {
    if (!configured.has("voice_synthesis")) missingSoundCapabilities.push("voice_synthesis");
    if (!configured.has("lip_sync")) missingSoundCapabilities.push("lip_sync");
  }
  if (ambienceRequired && unifiedCapability !== "native_audio_video" && !configured.has("ambient_audio")) missingSoundCapabilities.push("ambient_audio");
  const describeMissingCapability = (capabilityKey: WorkflowCapability) => {
    const definition = workflowCapabilities.find((item) => item.key === capabilityKey);
    return {
      key: capabilityKey,
      name: definition?.name ?? capabilityKey,
      reason: definition?.requirement ?? "当前片段生产路线缺少对应生成适配器",
      productionRoute: capabilityKey === "storyboard_frame" ? "visual_assets" as const : capabilityKey === "ambient_audio" ? "sound_enhancement" as const : "segment_video" as const,
    };
  };
  const missingCapabilityDetails = missingCapabilities.map(describeMissingCapability);
  const missingSoundCapabilityDetails = missingSoundCapabilities.map(describeMissingCapability);
  const requiredCapabilities = [...new Set(steps.filter((step) => step.capability !== "segment_compose").map((step) => step.capability).concat(missingCapabilities, missingSoundCapabilities))];
  const soundEnhancement = hasDialogue
    ? unifiedCapability === "native_audio_video"
      ? { status: "native" as const, message: "所选片段视频方案原生生成对白与口型" }
      : missingSoundCapabilities.length
        ? { status: "pending" as const, message: `分镜画面可与对白配音并行；仍缺 ${missingSoundCapabilityDetails.map((item) => item.name).join("、")}，可在设置中补配后重试声音` }
        : parallelVoiceStepId
          ? { status: "pending" as const, message: "分镜画面与对白配音将并行生成；视频会在两者就绪后继续" }
          : { status: "pending" as const, message: "先生成片段画面；固定音色、对白与口型将在声音增强阶段合入" }
    : ambienceRequired
      ? missingSoundCapabilities.includes("ambient_audio")
        ? { status: "pending" as const, message: "画面可先完成；环境声音场适配器尚未验证，可在设置中补配后合入" }
        : { status: "pending" as const, message: "本片段没有对白，将生成并合入项目锁定的连续环境声音场" }
      : { status: "not_required" as const, message: "本片段没有对白且未锁定环境声，画面完成即为可用片段" };
  const internalBlockers: string[] = [];
  const referencePayload = buildGenerationReferencePayload(references, formReferenceImages);
  const preferredStoryboardBinding = resolveWorkflowBinding(readiness.verifiedBindings, "storyboard_frame", referencePayload);
  const referenceImagesWired = Boolean(preferredStoryboardBinding && bindingAcceptsStoryboardReferences(preferredStoryboardBinding.inputContractJson));
  const hasSegmentReferences = Boolean(
    referencePayload.characterImageAssetIds.length
    || referencePayload.referenceAssetIds.length
    || referencePayload.propImageAssetIds.length
    || referencePayload.sceneAssetId,
  );
  return json({
    plan: {
      segmentId,
      status: missingCapabilities.length || missingAssets.length || internalBlockers.length ? "blocked" : "ready",
      steps,
      requiredCapabilities,
      missingCapabilities,
      missingCapabilityDetails,
      missingSoundCapabilities,
      missingSoundCapabilityDetails,
      internalBlockers,
      missingAssets,
      soundEnhancement,
      productionMode,
      referenceMode: segment.referenceMode === "manual" ? "manual" : "automatic",
      promptPreview: buildSegmentPrompt(segment, segmentShots, segmentDialogueLines),
      promptSource: segment.directorPrompt?.trim() ? "manual" : "automatic",
      configuredCapabilities: [...configured],
      referenceWiring: {
        hasReferences: hasSegmentReferences,
        wired: referenceImagesWired,
        bindingName: preferredStoryboardBinding?.name ?? null,
        bindingCapability: preferredStoryboardBinding?.capability ?? null,
        message: !hasSegmentReferences
          ? "未引用参考图，将按纯文生图出首帧"
          : referenceImagesWired
            ? `已引用参考图，将使用「${preferredStoryboardBinding?.name ?? "多参考分镜"}」锁定身份并生成电影分镜`
            : "已引用参考图，但当前可用工作流接不住参考图口子",
      },
    },
  });
}
