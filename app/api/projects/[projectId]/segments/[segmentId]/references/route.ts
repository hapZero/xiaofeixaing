import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { assets, characterFormReferences, characterForms, characters, episodes, segmentAssetReferences, segments, shots, storyBibles } from "../../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { loadEffectiveSegmentReferences, type EffectiveSegmentReference } from "../../../../../../lib/server/segment-references";
import { getRequestUser } from "../../../../../../lib/server/request-user";
import { visualAssetMediaReady, visualAssetProductionReady } from "../../../../../../lib/visual-asset-approval";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type SelectionKind = "character" | "character_form" | "scene" | "prop";
type ReferenceSelection = { kind: SelectionKind; id: string };
type UpdateBody = { mode?: "automatic" | "manual"; selections?: ReferenceSelection[] };
type CatalogOption = {
  key: string;
  kind: SelectionKind;
  id: string;
  role: "character" | "scene" | "prop";
  name: string;
  description: string;
  imageUrl: string | null;
  ready: boolean;
  assetId: string | null;
  characterId: string | null;
  characterFormId: string | null;
};

function identity(kind: SelectionKind, id: string) {
  return `${kind}:${id}`;
}

function referenceIdentity(reference: EffectiveSegmentReference) {
  if (reference.characterFormId) return identity("character_form", reference.characterFormId);
  if (reference.characterId) return identity("character", reference.characterId);
  if (reference.assetId && reference.referenceRole === "scene") return identity("scene", reference.assetId);
  if (reference.assetId && reference.referenceRole === "prop") return identity("prop", reference.assetId);
  return `reference:${reference.id}`;
}

function sameIdentitySet(left: string[], right: string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function invalidateGeneratedOutputs(segmentId: string) {
  const db = getDb();
  const now = new Date();
  await db.update(shots).set({ firstFrameAssetId: null, videoAssetId: null, status: "draft", updatedAt: now }).where(eq(shots.segmentId, segmentId));
  await db.update(segments).set({ videoAssetId: null, audioAssetId: null, currentVersionNumber: 0, status: "draft", updatedAt: now }).where(eq(segments.id, segmentId));
}

async function loadSegment(projectId: string, segmentId: string) {
  return (await getDb().select().from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1))[0]?.segments ?? null;
}

async function loadCatalog(projectId: string, sourceRevision: number) {
  const db = getDb();
  const [projectAssets, projectCharacters] = await Promise.all([
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
  ]);
  const activeAssets = projectAssets.filter((asset) => asset.sourceRevision === null || asset.sourceRevision === sourceRevision);
  const activeAssetById = new Map(activeAssets.map((asset) => [asset.id, asset]));
  const characterIds = projectCharacters.map((character) => character.id);
  const forms = characterIds.length ? await db.select().from(characterForms).where(inArray(characterForms.characterId, characterIds)) : [];
  const formIds = forms.map((form) => form.id);
  const formReferences = formIds.length
    ? await db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, formIds)).orderBy(characterFormReferences.referenceOrder)
    : [];
  const options: CatalogOption[] = [];

  for (const character of projectCharacters) {
    const characterFormsForCharacter = forms.filter((form) => form.characterId === character.id);
    const characterAsset = character.assetId ? activeAssetById.get(character.assetId) : null;
    options.push({
      key: identity("character", character.id), kind: "character", id: character.id, role: "character",
      name: `${character.canonicalName} · 默认形象`, description: characterFormsForCharacter.length ? "未指定形态时使用；也可以改选下方某个明确形态" : "角色默认形象",
      imageUrl: characterAsset?.thumbnailUrl ?? null,
      ready: visualAssetProductionReady(characterAsset), assetId: characterAsset?.id ?? character.assetId,
      characterId: character.id, characterFormId: null,
    });
    for (const form of characterFormsForCharacter) {
      const pack = formReferences.filter((reference) => reference.characterFormId === form.id);
      const primaryReference = pack.find((reference) => reference.isPrimary) ?? pack[0];
      const primaryAssetId = primaryReference?.assetId ?? form.assetId;
      const primaryAsset = primaryAssetId ? activeAssetById.get(primaryAssetId) : null;
      const requiredAssets = pack.length ? pack.map((reference) => activeAssetById.get(reference.assetId)) : [primaryAsset];
      options.push({
        key: identity("character_form", form.id), kind: "character_form", id: form.id, role: "character",
        name: `${character.canonicalName} · ${form.name}`, description: form.description || `用于保持${character.canonicalName}在本片段中的形态一致`,
        imageUrl: primaryAsset?.thumbnailUrl ?? null,
        ready: Boolean(visualAssetProductionReady(primaryAsset) && requiredAssets.every((asset) => visualAssetMediaReady(asset))),
        assetId: form.assetId ?? primaryReference?.assetId ?? null, characterId: character.id, characterFormId: form.id,
      });
    }
  }

  for (const role of ["scene", "prop"] as const) {
    for (const asset of activeAssets.filter((item) => item.assetType === role)) {
      options.push({
        key: identity(role, asset.id), kind: role, id: asset.id, role,
        name: asset.name, description: role === "scene" ? "片段空间与光线连续性参考" : "片段内需要保持一致的道具参考",
        imageUrl: asset.thumbnailUrl, ready: visualAssetProductionReady(asset),
        assetId: asset.id, characterId: null, characterFormId: null,
      });
    }
  }
  return options;
}

async function buildResponse(projectId: string, segment: typeof segments.$inferSelect) {
  const db = getDb();
  const segmentShots = await db.select().from(shots).where(eq(shots.segmentId, segment.id)).orderBy(shots.sequence);
  const storyBible = (await db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0];
  const options = await loadCatalog(projectId, storyBible?.sourceRevision ?? segment.sourceRevision ?? 1);
  const references = await loadEffectiveSegmentReferences(segment.id, segmentShots.map((shot) => shot.id), segment.referenceMode);
  const optionByKey = new Map(options.map((option) => [option.key, option]));
  const selectedKeys = [...new Set(references.map(referenceIdentity))];
  const shotSequenceById = new Map(segmentShots.map((shot) => [shot.id, shot.sequence]));
  const allShotSequences = segmentShots.map((shot) => shot.sequence);
  const display = selectedKeys.map((key) => {
    const option = optionByKey.get(key);
    const matching = references.filter((reference) => referenceIdentity(reference) === key);
    return {
      key,
      role: option?.role ?? matching[0]?.referenceRole ?? "reference",
      name: option?.name ?? "尚未关联标准图的引用",
      imageUrl: option?.imageUrl ?? null,
      missing: option ? !option.ready : true,
      shotSequences: segment.referenceMode === "manual"
        ? allShotSequences
        : [...new Set(matching.flatMap((reference) => reference.shotId ? [shotSequenceById.get(reference.shotId)] : []).filter((value): value is number => typeof value === "number"))].sort((a, b) => a - b),
    };
  });
  return { mode: segment.referenceMode === "manual" ? "manual" : "automatic", selectedKeys, options, references: display };
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const segment = await loadSegment(projectId, segmentId);
  if (!segment) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  return json(await buildResponse(projectId, segment));
}

export async function PUT(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const segment = await loadSegment(projectId, segmentId);
  if (!segment) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  const body = await readJson<UpdateBody>(request);
  if (!body || !["automatic", "manual"].includes(body.mode ?? "")) return errorResponse(400, "INVALID_REFERENCE_MODE", "请选择自动引用或人工调整引用");

  const db = getDb();
  if (body.mode === "automatic") {
    const segmentShots = await db.select({ id: shots.id }).from(shots).where(eq(shots.segmentId, segmentId));
    const shotIds = segmentShots.map((shot) => shot.id);
    const [currentReferences, automaticReferences] = await Promise.all([
      loadEffectiveSegmentReferences(segmentId, shotIds, segment.referenceMode),
      loadEffectiveSegmentReferences(segmentId, shotIds, "automatic"),
    ]);
    const changed = !sameIdentitySet(currentReferences.map(referenceIdentity), automaticReferences.map(referenceIdentity));
    await db.delete(segmentAssetReferences).where(eq(segmentAssetReferences.segmentId, segmentId));
    await db.update(segments).set({ referenceMode: "automatic", updatedAt: new Date() }).where(eq(segments.id, segmentId));
    if (changed) await invalidateGeneratedOutputs(segmentId);
    return json({ ...await buildResponse(projectId, { ...segment, referenceMode: "automatic" }), generationInvalidated: changed });
  }

  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (selections.length > 24) return errorResponse(400, "TOO_MANY_REFERENCES", "一个片段最多选择 24 项参考素材");
  const storyBible = (await db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0];
  const catalog = await loadCatalog(projectId, storyBible?.sourceRevision ?? segment.sourceRevision ?? 1);
  const catalogByKey = new Map(catalog.map((option) => [option.key, option]));
  const selectedOptions: CatalogOption[] = [];
  for (const selection of selections) {
    if (!selection || !["character", "character_form", "scene", "prop"].includes(selection.kind) || typeof selection.id !== "string") {
      return errorResponse(400, "INVALID_REFERENCE", "参考素材选择无效");
    }
    const option = catalogByKey.get(identity(selection.kind, selection.id));
    if (!option) return errorResponse(400, "REFERENCE_NOT_IN_PROJECT", "所选参考素材不属于当前项目");
    if (!selectedOptions.some((item) => item.key === option.key)) selectedOptions.push(option);
  }

  const segmentShots = await db.select({ id: shots.id }).from(shots).where(eq(shots.segmentId, segmentId));
  const currentReferences = await loadEffectiveSegmentReferences(segmentId, segmentShots.map((shot) => shot.id), segment.referenceMode);
  const changed = !sameIdentitySet(currentReferences.map(referenceIdentity), selectedOptions.map((option) => option.key));

  await db.delete(segmentAssetReferences).where(eq(segmentAssetReferences.segmentId, segmentId));
  const orderByRole = new Map<string, number>();
  if (selectedOptions.length) {
    const now = new Date();
    await db.insert(segmentAssetReferences).values(selectedOptions.map((option) => {
      const referenceOrder = orderByRole.get(option.role) ?? 0;
      orderByRole.set(option.role, referenceOrder + 1);
      return {
        id: crypto.randomUUID(), segmentId, assetId: option.assetId, characterId: option.characterId,
        characterFormId: option.characterFormId, referenceRole: option.role, referenceOrder,
        required: true, createdAt: now, updatedAt: now,
      };
    }));
  }
  await db.update(segments).set({ referenceMode: "manual", updatedAt: new Date() }).where(eq(segments.id, segmentId));
  if (changed) await invalidateGeneratedOutputs(segmentId);
  return json({ ...await buildResponse(projectId, { ...segment, referenceMode: "manual" }), generationInvalidated: changed });
}
