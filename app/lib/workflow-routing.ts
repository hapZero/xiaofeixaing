import { bindingCapabilityKey, workflowCapabilities } from "./workflow-capabilities";

export const workflowFallbacks: Readonly<Record<string, readonly string[]>> = {
  scene_image: ["image_generation"],
  prop_image: ["image_generation"],
  storyboard_frame: ["image_generation"],
  multi_character_storyboard: ["storyboard_frame", "image_generation"],
  multi_reference_image: ["storyboard_frame", "image_generation"],
  last_frame_image: ["image_generation"],
  image_edit: ["image_generation"],
  text_to_video: ["video_generation"],
  image_audio_video: ["native_audio_video"],
  // Do not alias multi_subject_video → generic video_generation.
  // The bound「多主体视频生成器」behaves like still-image morphing/slideshow, not LTX motion.
};

const STORYBOARD_REFERENCE_INPUTS = ["characterImages", "referenceImages", "sceneImage", "propImages"] as const;

export function parseBindingInputContract(inputContractJson: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(inputContractJson || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function bindingAcceptsStoryboardReferences(inputContractJson: string | null | undefined) {
  const contract = parseBindingInputContract(inputContractJson);
  return STORYBOARD_REFERENCE_INPUTS.some((key) => Boolean(contract[key]));
}

export function payloadWantsStoryboardReferences(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return false;
  const characterIds = payload.characterImageAssetIds;
  const referenceIds = payload.referenceAssetIds;
  const propIds = payload.propImageAssetIds;
  return Boolean(
    (Array.isArray(characterIds) && characterIds.length)
    || (Array.isArray(referenceIds) && referenceIds.length)
    || (Array.isArray(propIds) && propIds.length)
    || (typeof payload.sceneAssetId === "string" && payload.sceneAssetId),
  );
}

/**
 * Prefer reference-guided storyboard when the creator selected refs.
 * Never fall back to prompt-only 文生图 while refs are present.
 * Prefer structured characterImages+sceneImage over a flat referenceImages dump.
 */
export function scoreWorkflowBindingForPayload(
  binding: { capability: string; name?: string | null; inputContractJson?: string | null },
  payload: Record<string, unknown> | null | undefined,
  requestedCapability?: string,
) {
  const request = requestedCapability ?? "storyboard_frame";
  const contract = parseBindingInputContract(binding.inputContractJson);
  const wantsRefs = payloadWantsStoryboardReferences(payload);
  const acceptsRefs = bindingAcceptsStoryboardReferences(binding.inputContractJson);

  if (!wantsRefs) {
    if (binding.capability === request) return acceptsRefs ? 0 : 2;
    if (binding.capability === "storyboard_frame" || binding.capability === "image_generation") return acceptsRefs ? 0 : 1;
    return 0;
  }

  // Creator selected refs → prompt-only text-to-image is the wrong path.
  if (!acceptsRefs) return -100;

  let score = 0;
  if (Array.isArray(payload?.characterImageAssetIds) && payload.characterImageAssetIds.length && contract.characterImages) score += 40;
  if (typeof payload?.sceneAssetId === "string" && payload.sceneAssetId && contract.sceneImage) score += 20;
  if (Array.isArray(payload?.propImageAssetIds) && payload.propImageAssetIds.length && contract.propImages) score += 8;
  if (Array.isArray(payload?.referenceAssetIds) && payload.referenceAssetIds.length && contract.referenceImages) score += 25;
  if (binding.capability === "multi_character_storyboard") score += 6;
  if (binding.capability === "multi_reference_image") score += 3;
  if (binding.capability === "storyboard_frame") score += 4;
  // Mild penalty for paste/composite-named graphs, but still better than 文生图 when refs exist.
  if (/合成|拼接|拼贴|设定表/.test(binding.name ?? "")) score -= 4;
  return score;
}

export function effectiveVerifiedCapabilities(bindings: Array<{ capability: string }>) {
  const configured = new Set(bindings.map((binding) => binding.capability));
  for (const definition of Object.keys(workflowFallbacks)) {
    if (configured.has(bindingCapabilityKey(definition)) || configured.has(definition)) configured.add(definition);
  }
  for (const [specialized, fallbacks] of Object.entries(workflowFallbacks)) {
    if (fallbacks.some((capability) => configured.has(capability))) configured.add(specialized);
  }
  return configured;
}

export function workflowBindingCandidates(capability: string) {
  const bindingKey = bindingCapabilityKey(capability);
  const bindingKeySiblings = workflowCapabilities
    .filter((item) => item.key === capability || item.key === bindingKey || item.bindingKey === capability || item.bindingKey === bindingKey)
    .flatMap((item) => [item.key, item.bindingKey].filter((value): value is string => Boolean(value)));
  return [capability, bindingKey, ...bindingKeySiblings, ...(workflowFallbacks[capability] ?? []), ...(workflowFallbacks[bindingKey] ?? [])]
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function resolveWorkflowBinding<T extends { capability: string; name?: string | null; inputContractJson?: string | null }>(
  bindings: readonly T[],
  capability: string,
  payload?: Record<string, unknown> | null,
) {
  const matched = workflowBindingCandidates(capability)
    .flatMap((candidate) => bindings.filter((binding) => binding.capability === candidate));
  if (!matched.length) return null;
  if (!payload) return matched[0] ?? null;
  return [...matched].sort((left, right) => (
    scoreWorkflowBindingForPayload(right, payload, capability) - scoreWorkflowBindingForPayload(left, payload, capability)
  ))[0] ?? null;
}
