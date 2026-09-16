import type { WorkflowCapability } from "./workflow-capabilities";

export type ProductionRoutingRule = {
  id: string;
  ruleKey: string;
  name: string;
  condition: Record<string, unknown>;
  targetCapability: WorkflowCapability;
  priority: number;
  enabled: boolean;
};

export const defaultProductionRoutingRules: readonly Omit<ProductionRoutingRule, "id">[] = [
  {
    ruleKey: "empty_shot_text_to_video",
    name: "空镜 → 文生视频",
    condition: { characterCount: 0, hasDialogue: false },
    targetCapability: "text_to_video",
    priority: 10,
    enabled: true,
  },
  {
    ruleKey: "dialogue_image_audio",
    name: "单人对白 → 图片 + 音频",
    condition: { hasDialogue: true, characterCountMax: 1 },
    targetCapability: "image_audio_video",
    priority: 20,
    enabled: true,
  },
  {
    ruleKey: "first_last_frame",
    name: "有首尾帧 → 首尾帧视频",
    condition: { hasFirstFrame: true, hasLastFrame: true },
    targetCapability: "first_last_frame_video",
    priority: 30,
    enabled: true,
  },
  {
    ruleKey: "multi_subject",
    name: "多人镜头 → 图生视频",
    condition: { characterCountMin: 2 },
    // Prefer cinematic I2V. Dedicated multi-subject generators in this project tend to morph stills.
    targetCapability: "image_to_video",
    priority: 40,
    enabled: true,
  },
  {
    ruleKey: "identity_replace",
    name: "复杂动作 → 参考视频换角色",
    condition: { needsIdentityReplacement: true },
    targetCapability: "reference_video_character",
    priority: 50,
    enabled: true,
  },
  {
    ruleKey: "default_image_to_video",
    name: "默认 → 图生视频",
    condition: { default: true },
    targetCapability: "image_to_video",
    priority: 100,
    enabled: true,
  },
];

export type ShotRoutingIntent = {
  characterCount: number;
  hasDialogue: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  needsIdentityReplacement?: boolean;
};

function matchesCondition(condition: Record<string, unknown>, intent: ShotRoutingIntent) {
  if (condition.default === true) return true;
  if (typeof condition.characterCount === "number" && intent.characterCount !== condition.characterCount) return false;
  if (typeof condition.characterCountMin === "number" && intent.characterCount < condition.characterCountMin) return false;
  if (typeof condition.characterCountMax === "number" && intent.characterCount > condition.characterCountMax) return false;
  if (typeof condition.hasDialogue === "boolean" && intent.hasDialogue !== condition.hasDialogue) return false;
  if (typeof condition.hasFirstFrame === "boolean" && intent.hasFirstFrame !== condition.hasFirstFrame) return false;
  if (typeof condition.hasLastFrame === "boolean" && intent.hasLastFrame !== condition.hasLastFrame) return false;
  if (typeof condition.needsIdentityReplacement === "boolean" && Boolean(intent.needsIdentityReplacement) !== condition.needsIdentityReplacement) return false;
  return true;
}

export function resolveRoutingTargetCapability(
  intent: ShotRoutingIntent,
  configured: ReadonlySet<string>,
  rules: readonly ProductionRoutingRule[] = defaultProductionRoutingRules.map((rule, index) => ({ ...rule, id: `default:${index}` })),
): WorkflowCapability {
  if (intent.hasDialogue && configured.has("native_audio_video")) return "native_audio_video";
  const ordered = [...rules].filter((rule) => rule.enabled).sort((left, right) => left.priority - right.priority);
  for (const rule of ordered) {
    if (!matchesCondition(rule.condition, intent)) continue;
    if (configured.has(rule.targetCapability)) return rule.targetCapability;
    const alias = rule.targetCapability === "text_to_video" && configured.has("video_generation") ? "video_generation" : null;
    if (alias && configured.has(alias)) return alias as WorkflowCapability;
    if (rule.targetCapability === "image_audio_video" && configured.has("native_audio_video")) return "native_audio_video";
  }
  if (configured.has("image_to_video")) return "image_to_video";
  if (configured.has("native_audio_video")) return "native_audio_video";
  return "image_to_video";
}

export function mergeRoutingRules(stored: ProductionRoutingRule[]) {
  const byKey = new Map(defaultProductionRoutingRules.map((rule) => [rule.ruleKey, rule]));
  for (const rule of stored) byKey.set(rule.ruleKey, rule);
  return [...byKey.values()]
    .map((rule, index) => ({ ...rule, id: stored.find((item) => item.ruleKey === rule.ruleKey)?.id ?? `default:${index}` }))
    .sort((left, right) => left.priority - right.priority);
}
