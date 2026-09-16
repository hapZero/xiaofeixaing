import { and, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../db";
import { assets, characterForms, characters, dialogueLines, episodes, generationJobs, segments, shots } from "../../../db/schema";
import { isWorkflowCapability, workflowCapabilities, type WorkflowCapability } from "../../lib/workflow-capabilities";
import { prepareLtxWorkflowExecution } from "../ltx-video-prompt";
import { buildVoiceSynthesisText, prepareVoiceSynthesisExecution } from "./voice-synthesis-prompt";
import { describeGenerationError } from "../generation-errors";
import { applyWorkflowInputs, assertWorkflowInputsApplied, comfyUiConfigured, ensureOptionalReferenceImage, loadWorkflow, queueWorkflow, scrubMappedMediaPlaceholders, uploadWorkflowInput } from "./comfyui";
import { getVerifiedWorkflowBinding } from "./verified-workflows";

export type SubmitGenerationJobInput = {
  projectId: string;
  entityType: string;
  entityId: string;
  capability: string;
  payload?: Record<string, unknown>;
};

export type SubmittedGenerationJob = {
  id: string;
  status: string;
  promptId: string | null;
  capability: WorkflowCapability;
  progressSource?: "bridge" | "polling";
  reused?: boolean;
};

export class GenerationSubmissionError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function generationEntityBelongsToProject(entityType: string, entityId: string, projectId: string): Promise<boolean> {
  const db = getDb();
  if (entityType === "asset") return Boolean((await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, entityId), eq(assets.projectId, projectId))).limit(1))[0]);
  if (entityType === "character") return Boolean((await db.select({ id: characters.id }).from(characters).where(and(eq(characters.id, entityId), eq(characters.projectId, projectId))).limit(1))[0]);
  if (entityType === "character_form") {
    const form = (await db.select({ characterId: characterForms.characterId }).from(characterForms).where(eq(characterForms.id, entityId)).limit(1))[0];
    return Boolean(form && (await db.select({ id: characters.id }).from(characters).where(and(eq(characters.id, form.characterId), eq(characters.projectId, projectId))).limit(1))[0]);
  }
  if (entityType === "shot") {
    const shot = (await db.select({ episodeId: shots.episodeId }).from(shots).where(eq(shots.id, entityId)).limit(1))[0];
    return Boolean(shot && (await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, shot.episodeId), eq(episodes.projectId, projectId))).limit(1))[0]);
  }
  if (entityType === "segment") {
    const segment = (await db.select({ episodeId: segments.episodeId }).from(segments).where(eq(segments.id, entityId)).limit(1))[0];
    return Boolean(segment && (await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, segment.episodeId), eq(episodes.projectId, projectId))).limit(1))[0]);
  }
  if (entityType === "dialogue_line") {
    const line = (await db.select({ shotId: dialogueLines.shotId }).from(dialogueLines).where(eq(dialogueLines.id, entityId)).limit(1))[0];
    const shot = line ? (await db.select({ episodeId: shots.episodeId }).from(shots).where(eq(shots.id, line.shotId)).limit(1))[0] : null;
    return Boolean(shot && (await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, shot.episodeId), eq(episodes.projectId, projectId))).limit(1))[0]);
  }
  return false;
}

async function attachAssetInput(options: {
  projectId: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  contract: Record<string, { nodeId: string; input: string }>;
  idKey: string;
  inputKey: string;
}) {
  if (typeof options.payload[options.idKey] !== "string" || !options.contract[options.inputKey]) return;
  const asset = (await getDb().select().from(assets).where(and(
    eq(assets.id, options.payload[options.idKey] as string),
    eq(assets.projectId, options.projectId),
  )).limit(1))[0];
  if (!asset?.storageKey) throw new Error(`${options.idKey.toUpperCase()}_NOT_FOUND`);
  const object = await getMediaBucket().get(asset.storageKey);
  if (!object) throw new Error(`${options.idKey.toUpperCase()}_FILE_NOT_FOUND`);
  const fallbackExtension = object.httpMetadata?.contentType?.startsWith("audio/") ? ".wav" : object.httpMetadata?.contentType?.startsWith("video/") ? ".mp4" : ".png";
  const filename = asset.name || `${options.inputKey}${fallbackExtension}`;
  const file = new File([await object.arrayBuffer()], filename, { type: object.httpMetadata?.contentType ?? "application/octet-stream" });
  const uploaded = await uploadWorkflowInput(file, `xiaofeixiang-${options.entityType}-${options.entityId}`);
  options.payload[options.inputKey] = uploaded.workflowValue;
}

async function attachAssetListInput(options: {
  projectId: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  contract: Record<string, { nodeId: string; input: string }>;
  idsKey: string;
  inputKey: string;
}) {
  const ids = options.payload[options.idsKey];
  if (!Array.isArray(ids) || !options.contract[options.inputKey]) return;
  const values: unknown[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const asset = (await getDb().select().from(assets).where(and(eq(assets.id, id), eq(assets.projectId, options.projectId))).limit(1))[0];
    if (!asset?.storageKey) throw new Error(`${options.idsKey.toUpperCase()}_NOT_FOUND`);
    const object = await getMediaBucket().get(asset.storageKey);
    if (!object) throw new Error(`${options.idsKey.toUpperCase()}_FILE_NOT_FOUND`);
    const file = new File([await object.arrayBuffer()], asset.name || `${options.inputKey}.png`, { type: object.httpMetadata?.contentType ?? "image/png" });
    values.push((await uploadWorkflowInput(file, `xiaofeixiang-${options.entityType}-${options.entityId}`)).workflowValue);
  }
  options.payload[options.inputKey] = values;
}

export async function submitGenerationJobForUser(ownerId: string, input: SubmitGenerationJobInput): Promise<SubmittedGenerationJob> {
  if (!input.projectId || !input.entityType || !input.entityId || !input.capability || !isWorkflowCapability(input.capability)) {
    throw new GenerationSubmissionError(400, "INVALID_JOB", "生成任务参数不完整");
  }
  const capability = input.capability;
  if (!await generationEntityBelongsToProject(input.entityType, input.entityId, input.projectId)) {
    throw new GenerationSubmissionError(404, "GENERATION_ENTITY_NOT_FOUND", "生成对象不存在或不属于当前项目");
  }

  const requirement = workflowCapabilities.find((item) => item.key === capability);
  const db = getDb();
  let activeJob: typeof generationJobs.$inferSelect | undefined = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, ownerId),
    eq(generationJobs.projectId, input.projectId),
    eq(generationJobs.entityType, input.entityType),
    eq(generationJobs.entityId, input.entityId),
    eq(generationJobs.capability, capability),
    inArray(generationJobs.status, ["submitting", "queued", "running"]),
  )).limit(1))[0];
  if (activeJob?.status === "submitting" && Date.now() - activeJob.updatedAt.getTime() > 5 * 60 * 1_000) {
    const failedAt = new Date();
    await db.update(generationJobs).set({ status: "failed", errorCode: "GENERATION_SUBMIT_INTERRUPTED", errorMessage: "任务提交过程被中断，可安全重新提交", finishedAt: failedAt, updatedAt: failedAt }).where(and(eq(generationJobs.id, activeJob.id), eq(generationJobs.status, "submitting")));
    activeJob = undefined;
  }
  if (activeJob) return { id: activeJob.id, status: activeJob.status, promptId: activeJob.comfyPromptId, capability, entityType: input.entityType, entityId: input.entityId, reused: true };

  const binding = await getVerifiedWorkflowBinding(ownerId, capability, input.payload ?? null);
  if (!binding) throw new GenerationSubmissionError(409, "WORKFLOW_NOT_VERIFIED", `“${requirement?.name ?? capability}”需要先绑定并通过一次真实测试，才能进入短剧生产`, requirement);
  if (!comfyUiConfigured()) throw new GenerationSubmissionError(503, "COMFYUI_NOT_CONFIGURED", "尚未配置 ComfyUI 服务地址");

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(generationJobs).values({ id, ownerId, projectId: input.projectId, entityType: input.entityType, entityId: input.entityId, capability, workflowBindingId: binding.id, status: "submitting", payloadJson: JSON.stringify(input.payload ?? {}), createdAt: now, updatedAt: now });
  try {
    const contract = JSON.parse(binding.inputContractJson) as Record<string, { nodeId: string; input: string }>;
    const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
    for (const [idKey, inputKey] of [
      ["firstFrameAssetId", "firstFrame"],
      ["lastFrameAssetId", "lastFrame"],
      ["videoAssetId", "video"],
      ["audioAssetId", "audio"],
      ["voiceReferenceAssetId", "voiceReference"],
      ["referenceAudioAssetId", "referenceAudio"],
      ["sceneAssetId", "sceneImage"],
      ["referenceImageAssetId", "referenceImage"],
    ] as const) {
      await attachAssetInput({ projectId: input.projectId, entityType: input.entityType, entityId: input.entityId, payload, contract, idKey, inputKey });
    }
    await attachAssetListInput({ projectId: input.projectId, entityType: input.entityType, entityId: input.entityId, payload, contract, idsKey: "characterImageAssetIds", inputKey: "characterImages" });
    await attachAssetListInput({ projectId: input.projectId, entityType: input.entityType, entityId: input.entityId, payload, contract, idsKey: "propImageAssetIds", inputKey: "propImages" });
    await attachAssetListInput({ projectId: input.projectId, entityType: input.entityType, entityId: input.entityId, payload, contract, idsKey: "referenceAssetIds", inputKey: "referenceImages" });
    // Multi-subject / first-last workflows often map lastFrame even when the shot has none.
    // Reuse the uploaded first frame so ComfyUI node validation does not hit a missing baked file.
    if (
      contract.lastFrame
      && (payload.lastFrame === undefined || payload.lastFrame === null || payload.lastFrame === "")
      && typeof payload.firstFrame === "string"
      && payload.firstFrame
    ) {
      payload.lastFrame = payload.firstFrame;
    }
    for (const inputDefinition of requirement?.inputs ?? []) {
      if (!inputDefinition.required || !contract[inputDefinition.key]) continue;
      const value = payload[inputDefinition.key];
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        throw new GenerationSubmissionError(409, "WORKFLOW_INPUT_REFERENCE_MISSING", `“${inputDefinition.label}”未映射到可用资产，无法提交生产任务`);
      }
    }
    const synthesizedText = capability === "voice_synthesis" ? buildVoiceSynthesisText(payload) : undefined;
    if (synthesizedText) payload.text = synthesizedText;
    if (capability === "character_image" && contract.referenceImage && (payload.referenceImage === undefined || payload.referenceImage === null || payload.referenceImage === "")) {
      throw new GenerationSubmissionError(409, "CHARACTER_REFERENCE_REQUIRED", "人物一致性需要已有参考图，请先用文生图生成并锁定基础形态，或上传概念图后再生成剧情形态");
    }
    if (capability !== "character_image") {
      await ensureOptionalReferenceImage(payload, contract, uploadWorkflowInput, `xiaofeixiang-${input.entityType}-${input.entityId}`);
    }
    let workflow = scrubMappedMediaPlaceholders(
      await loadWorkflow(binding.workflowStorageKey),
      contract,
      payload,
    );
    if (capability === "voice_synthesis") workflow = prepareVoiceSynthesisExecution(workflow, contract, payload);
    const { workflow: ltxWorkflow, payload: executionPayload } = prepareLtxWorkflowExecution(workflow, payload, capability);
    const prepared = applyWorkflowInputs(ltxWorkflow, contract, executionPayload);
    assertWorkflowInputsApplied(prepared, contract, executionPayload);
    const queued = await queueWorkflow(prepared, { executionType: "generation_job", executionId: id, ownerId, projectId: input.projectId, capability, bindingId: binding.id });
    await db.update(generationJobs).set({ status: "queued", comfyPromptId: queued.promptId, startedAt: new Date(), updatedAt: new Date() }).where(eq(generationJobs.id, id));
    return { id, status: "queued", promptId: queued.promptId, capability, entityType: input.entityType, entityId: input.entityId, progressSource: queued.bridgeRegistered ? "bridge" : "polling" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_GENERATION_ERROR";
    await db.update(generationJobs).set({ status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(generationJobs.id, id));
    throw new GenerationSubmissionError(502, "GENERATION_SUBMIT_FAILED", describeGenerationError(message), { jobId: id, reason: message });
  }
}
