import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { assets, characterFormReferences, characterForms, characters, mediaJobs, projects } from "../../../db/schema";
import type { WorkflowCapability } from "../workflow-capabilities";
import { resolveCharacterConceptCapability, resolveCharacterPackCapability } from "../character-visual-generation";

export const visualAssetBatchOperation = "project_visual_asset_generation";

export type VisualAssetBatchItem = {
  key: string;
  entityType: "character" | "character_form" | "asset";
  entityId: string;
  capability: WorkflowCapability;
  title: string;
  prompt: string;
  characterId?: string;
};

export type VisualAssetBatchPayload = {
  items: VisualAssetBatchItem[];
  currentIndex: number;
  attemptedKeys: string[];
  runnerLeaseToken?: string;
  runnerLeaseExpiresAt?: number;
};

export function parseVisualAssetBatchPayload(value: string): VisualAssetBatchPayload {
  try {
    const parsed = JSON.parse(value) as Partial<VisualAssetBatchPayload>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.filter((item): item is VisualAssetBatchItem => Boolean(item && typeof item.key === "string" && typeof item.entityId === "string")) : [],
      currentIndex: Math.max(0, Number(parsed.currentIndex) || 0),
      attemptedKeys: Array.isArray(parsed.attemptedKeys) ? parsed.attemptedKeys.filter((key): key is string => typeof key === "string") : [],
      runnerLeaseToken: typeof parsed.runnerLeaseToken === "string" ? parsed.runnerLeaseToken : undefined,
      runnerLeaseExpiresAt: Number.isFinite(Number(parsed.runnerLeaseExpiresAt)) ? Number(parsed.runnerLeaseExpiresAt) : undefined,
    };
  } catch {
    return { items: [], currentIndex: 0, attemptedKeys: [] };
  }
}

function assetDescription(metadataJson: string) {
  try {
    const value = (JSON.parse(metadataJson) as { description?: unknown }).description;
    return typeof value === "string" && value.trim() ? value.trim() : "根据全剧设定保持外观稳定一致";
  } catch {
    return "根据全剧设定保持外观稳定一致";
  }
}

function characterDescription(profileJson: string) {
  try {
    const value = (JSON.parse(profileJson) as { description?: unknown }).description;
    return typeof value === "string" && value.trim() ? value.trim() : "根据剧本保持身份一致";
  } catch {
    return "根据剧本保持身份一致";
  }
}

function isReadyImageAsset(asset: { status: string; storageKey: string | null; thumbnailUrl?: string | null } | null | undefined) {
  return Boolean(asset?.status === "ready" && asset.storageKey);
}

/** 仅统计指向真实图片的图包引用；提取占位 / 空壳 primary 不算已出图包 */
function formHasReadyPack(
  formId: string,
  formReferences: Array<{ characterFormId: string; assetId: string }>,
  projectAssets: Array<{ id: string; status: string; storageKey: string | null }>,
) {
  return formReferences.some((reference) =>
    reference.characterFormId === formId
    && isReadyImageAsset(projectAssets.find((asset) => asset.id === reference.assetId) ?? null),
  );
}

export async function buildVisualAssetBatchItems(projectId: string): Promise<VisualAssetBatchItem[]> {
  const db = getDb();
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0] ?? null;
  if (!project) return [];
  const [projectCharacters, forms, projectAssets, formReferences] = await Promise.all([
    db.select().from(characters).where(eq(characters.projectId, projectId)).orderBy(characters.createdAt),
    db.select().from(characterForms).orderBy(characterForms.createdAt),
    db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(assets.createdAt),
    db.select().from(characterFormReferences),
  ]);

  const characterItems = projectCharacters.flatMap((character) => {
    const characterFormsForCharacter = forms.filter((form) => form.characterId === character.id);
    return characterFormsForCharacter.flatMap((form) => {
      if (formHasReadyPack(form.id, formReferences, projectAssets)) return [];
      const concept = form.assetId
        ? projectAssets.find((item) => item.id === form.assetId && isReadyImageAsset(item)) ?? null
        : null;
      if (!concept) {
        return [{
          key: `character_form_concept:${form.id}`,
          entityType: "character_form" as const,
          entityId: form.id,
          capability: resolveCharacterConceptCapability(),
          title: `${character.canonicalName} · ${form.name} · 概念图`,
          characterId: character.id,
          prompt: `角色：${character.canonicalName}。角色基础设定：${characterDescription(character.profileJson)}。当前形态：${form.name}。形态设定：${form.description || "沿用角色基础设定"}。视觉风格：${project.stylePreset}。生成该形态的概念锚点图，单张正面半身或全身，不要添加文字、水印或无关人物。`,
        }];
      }
      const capability = resolveCharacterPackCapability(true);
      if (!capability) return [];
      return [{
        key: `character_form_pack:${form.id}`,
        entityType: "character_form" as const,
        entityId: form.id,
        capability,
        title: `${character.canonicalName} · ${form.name}`,
        characterId: character.id,
        prompt: `角色：${character.canonicalName}。角色基础设定：${characterDescription(character.profileJson)}。当前形态：${form.name}。形态设定：${form.description || "沿用角色基础设定"}。视觉风格：${project.stylePreset}。生成可跨分镜复用的角色标准图包（含三视图），保持脸部身份、年龄、发型和体型稳定，并准确呈现当前服装与状态。不要添加文字、水印或无关人物。`,
      }];
    });
  });

  const visualItems = projectAssets.filter((asset) => asset.assetType === "scene" || asset.assetType === "prop").map((asset) => ({
    key: `asset:${asset.id}`,
    entityType: "asset" as const,
    entityId: asset.id,
    capability: "image_generation" as WorkflowCapability,
    title: `${asset.assetType === "scene" ? "场景" : "道具"} · ${asset.name}`,
    prompt: `${asset.assetType === "scene" ? "场景" : "关键道具"}：${asset.name}。设定：${assetDescription(asset.metadataJson)}。视觉风格：${project.stylePreset}。生成可在全剧分镜中稳定复用的${asset.assetType === "scene" ? "场景标准图" : "道具标准图"}，不要添加无关角色、文字或水印。`,
  }));
  return [...characterItems, ...visualItems];
}

export async function visualAssetBatchItemGenerated(projectId: string, item: VisualAssetBatchItem) {
  const db = getDb();
  if (item.entityType === "asset") {
    const asset = (await db.select().from(assets).where(and(eq(assets.id, item.entityId), eq(assets.projectId, projectId))).limit(1))[0] ?? null;
    return Boolean(asset?.storageKey && asset.thumbnailUrl && asset.status === "ready");
  }
  if (item.entityType === "character") {
    const character = (await db.select().from(characters).where(and(eq(characters.id, item.entityId), eq(characters.projectId, projectId))).limit(1))[0] ?? null;
    if (!character?.assetId) return false;
    const asset = (await db.select().from(assets).where(and(eq(assets.id, character.assetId), eq(assets.projectId, projectId))).limit(1))[0] ?? null;
    return Boolean(asset?.storageKey && asset.thumbnailUrl && asset.status === "ready");
  }
  const form = (await db.select().from(characterForms).where(eq(characterForms.id, item.entityId)).limit(1))[0] ?? null;
  if (!form) return false;
  if (item.capability === "image_generation") {
    if (!form.assetId) return false;
    const asset = (await db.select().from(assets).where(and(eq(assets.id, form.assetId), eq(assets.projectId, projectId))).limit(1))[0] ?? null;
    return Boolean(asset?.storageKey && asset.thumbnailUrl && asset.status === "ready");
  }
  const refs = await db.select({
    id: characterFormReferences.id,
    storageKey: assets.storageKey,
    status: assets.status,
  }).from(characterFormReferences)
    .innerJoin(assets, eq(assets.id, characterFormReferences.assetId))
    .where(eq(characterFormReferences.characterFormId, form.id))
    .limit(32);
  return refs.some((reference) => reference.status === "ready" && Boolean(reference.storageKey));
}

export async function visualAssetBatchJobPayload(projectId: string, item: VisualAssetBatchItem) {
  const project = (await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1))[0] ?? null;
  const payload: Record<string, unknown> = { prompt: item.prompt, aspectRatio: project?.aspectRatio ?? "9:16", stylePreset: project?.stylePreset ?? "写实电影风格" };
  if (item.entityType === "character_form" && item.capability === "character_image") {
    const form = (await getDb().select().from(characterForms).where(eq(characterForms.id, item.entityId)).limit(1))[0] ?? null;
    const reference = form?.assetId
      ? (await getDb().select().from(assets).where(and(eq(assets.id, form.assetId), eq(assets.projectId, projectId))).limit(1))[0] ?? null
      : null;
    if (reference?.storageKey && reference.status === "ready") payload.referenceImageAssetId = reference.id;
  }
  return payload;
}

export async function latestVisualAssetBatches(ownerId: string, projectId: string) {
  return getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, ownerId),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "project"),
    eq(mediaJobs.entityId, projectId),
    eq(mediaJobs.operation, visualAssetBatchOperation),
  )).orderBy(desc(mediaJobs.createdAt)).limit(20);
}
