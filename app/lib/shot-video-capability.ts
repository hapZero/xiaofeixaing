import type { WorkflowCapability } from "./workflow-capabilities";
import { bindingCapabilityKey } from "./workflow-capabilities";

export const shotVideoCapabilityOptions = [
  { key: "image_to_video", label: "图生视频", hint: "根据首帧和动作描述生成" },
  { key: "first_last_frame_video", label: "首尾帧视频", hint: "需要首帧与尾帧，控制动作起止" },
  { key: "multi_subject_video", label: "多角色视频", hint: "多人同框并保持角色身份" },
  { key: "image_audio_video", label: "图片 + 音频", hint: "需先完成对白配音" },
  { key: "text_to_video", label: "文生视频", hint: "空镜或环境镜头" },
  { key: "reference_video_character", label: "参考视频换角色", hint: "复杂动作保留原运动" },
] as const;

export type ShotVideoCapability = (typeof shotVideoCapabilityOptions)[number]["key"];

const shotVideoCapabilities = new Set<string>(shotVideoCapabilityOptions.map((option) => option.key));

export type ShotGenerationPlan = {
  intent?: Record<string, unknown>;
  videoCapability?: ShotVideoCapability | WorkflowCapability;
  lastFrameAssetId?: string | null;
  automaticallyResolved?: boolean;
};

export function parseShotGenerationPlan(value: string | null | undefined): ShotGenerationPlan {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as ShotGenerationPlan;
  } catch {
    return {};
  }
}

export function mergeShotGenerationPlan(existing: string | null | undefined, patch: Partial<ShotGenerationPlan>): string {
  const current = parseShotGenerationPlan(existing);
  const next: ShotGenerationPlan = { ...current, ...patch };
  if (patch.videoCapability && patch.videoCapability !== "first_last_frame_video") {
    next.lastFrameAssetId = null;
  }
  return JSON.stringify(next);
}

export function readShotVideoCapabilitySelection(plan: ShotGenerationPlan): WorkflowCapability {
  return plan.videoCapability && shotVideoCapabilities.has(plan.videoCapability) ? plan.videoCapability as WorkflowCapability : "image_to_video";
}

export function resolveShotVideoCapability(plan: ShotGenerationPlan, configured: ReadonlySet<string>): WorkflowCapability {
  const requested = readShotVideoCapabilitySelection(plan);
  // Legacy plans may still say multi_subject_video; without a dedicated binding use LTX I2V.
  if (requested === "multi_subject_video" && !configured.has("multi_subject_video")) {
    if (configured.has("image_to_video")) return "image_to_video";
  }
  const bindingKey = bindingCapabilityKey(requested);
  if (configured.has(requested) || configured.has(bindingKey)) return requested;
  if (configured.has("image_to_video")) return "image_to_video";
  if (configured.has("image_audio_video") || configured.has("native_audio_video")) return configured.has("image_audio_video") ? "image_audio_video" : "native_audio_video";
  if (configured.has("multi_subject_video")) return "multi_subject_video";
  if (configured.has("first_last_frame_video")) return "first_last_frame_video";
  if (configured.has("text_to_video") || configured.has("video_generation")) return configured.has("text_to_video") ? "text_to_video" : "video_generation";
  return "image_to_video";
}

export function shotVideoGenerationBlockers(options: {
  capability: WorkflowCapability;
  plan: ShotGenerationPlan;
  firstFrameAssetId: string | null;
  dialogueAudioReady?: boolean;
}): string[] {
  const blockers: string[] = [];
  if (options.capability !== "multi_subject_video" && options.capability !== "text_to_video" && options.capability !== "reference_video_character" && !options.firstFrameAssetId) {
    blockers.push("需要分镜首帧");
  }
  if (options.capability === "first_last_frame_video" && !options.plan.lastFrameAssetId) {
    blockers.push("需要尾帧画面");
  }
  if ((options.capability === "image_audio_video" || options.capability === "native_audio_video") && options.dialogueAudioReady === false) {
    blockers.push("需要完成对白配音");
  }
  return blockers;
}

export function buildShotVideoJobPayload(options: {
  shot: { firstFrameAssetId: string | null; prompt: string; durationMs: number; generationPlanJson: string };
  capability: WorkflowCapability;
  segmentPipeline?: boolean;
  referencePayload?: Record<string, unknown>;
  dialogueAudioAssetId?: string | null;
  measuredDurationMs?: number | null;
}): Record<string, unknown> {
  const plan = parseShotGenerationPlan(options.shot.generationPlanJson);
  const durationMs = options.measuredDurationMs && options.measuredDurationMs > 0 ? options.measuredDurationMs : options.shot.durationMs;
  const payload: Record<string, unknown> = {
    prompt: options.shot.prompt,
    duration: Math.max(1, Math.round(durationMs / 1_000)),
    segmentPipeline: options.segmentPipeline ?? false,
    ...(options.referencePayload ?? {}),
  };
  if (options.shot.firstFrameAssetId) payload.firstFrameAssetId = options.shot.firstFrameAssetId;
  if (options.capability === "first_last_frame_video" && plan.lastFrameAssetId) {
    payload.lastFrameAssetId = plan.lastFrameAssetId;
  }
  if (options.dialogueAudioAssetId && (options.capability === "image_audio_video" || options.capability === "native_audio_video")) {
    payload.audioAssetId = options.dialogueAudioAssetId;
  }
  return payload;
}

export function shotDialogueAudioReady(lines: Array<{ audioAssetId: string | null }>) {
  return lines.length === 0 || lines.every((line) => Boolean(line.audioAssetId));
}

export function measuredShotDurationMs(shotDurationMs: number, lines: Array<{ durationMs: number | null }>, paddingMs = 300) {
  const measured = lines.reduce((total, line) => total + (line.durationMs ?? 0), 0);
  return measured > 0 ? measured + paddingMs : shotDurationMs;
}
