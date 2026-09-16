import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { assets, characterForms, characters } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { invalidateCharacterVoice } from "../../../../../lib/server/sound-invalidation";
import { invalidateVisualDependencyOutputs } from "../../../../../lib/server/production-state";
import { updateVisualAssetApproval } from "../../../../../lib/visual-asset-approval";

type RouteContext = { params: Promise<{ projectId: string; characterId: string }> };
type UpdateCharacterBody = Partial<{
  canonicalName: string;
  voiceDescription: string;
  voiceAssetId: string | null;
  voiceLocked: boolean;
  assetId: string | null;
  formId: string | null;
}>;

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, characterId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdateCharacterBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const db = getDb();
  const existing = await db.select().from(characters).where(and(eq(characters.id, characterId), eq(characters.projectId, projectId))).limit(1);
  if (!existing[0]) return errorResponse(404, "CHARACTER_NOT_FOUND", "角色不存在或无权访问");
  const previous = existing[0];
  const updatedAt = new Date();
  const update: { canonicalName?: string; voiceDescription?: string; voiceAssetId?: string | null; voiceLocked?: boolean; assetId?: string | null; updatedAt: Date } = { updatedAt };
  if (typeof body.canonicalName === "string" && body.canonicalName.trim()) update.canonicalName = body.canonicalName.trim().slice(0, 80);
  if (typeof body.voiceDescription === "string") update.voiceDescription = body.voiceDescription.trim().slice(0, 2_000);
  if (typeof body.voiceAssetId === "string") {
    const voiceAsset = (await db.select().from(assets).where(and(eq(assets.id, body.voiceAssetId), eq(assets.projectId, projectId))).limit(1))[0];
    if (!voiceAsset?.storageKey || voiceAsset.status !== "ready") return errorResponse(400, "VOICE_ASSET_INVALID", "选择的音色参考文件不存在或尚未就绪");
    let mediaType = "";
    try { mediaType = String((JSON.parse(voiceAsset.metadataJson) as { mediaType?: unknown }).mediaType ?? ""); } catch { mediaType = ""; }
    if (mediaType !== "audio" && !voiceAsset.assetType.includes("audio")) return errorResponse(400, "VOICE_ASSET_INVALID", "角色音色参考必须是音频文件");
    update.voiceAssetId = voiceAsset.id;
  } else if (body.voiceAssetId === null) update.voiceAssetId = null;
  if (typeof body.voiceLocked === "boolean") update.voiceLocked = body.voiceLocked;
  if (typeof body.assetId === "string") {
    const concept = (await db.select().from(assets).where(and(eq(assets.id, body.assetId), eq(assets.projectId, projectId))).limit(1))[0];
    if (!concept?.storageKey || concept.status !== "ready") return errorResponse(400, "CONCEPT_ASSET_INVALID", "概念图不存在或尚未就绪");
    let mediaType = "";
    try { mediaType = String((JSON.parse(concept.metadataJson) as { mediaType?: unknown }).mediaType ?? ""); } catch { mediaType = ""; }
    if (mediaType && mediaType !== "image") return errorResponse(400, "CONCEPT_ASSET_INVALID", "角色概念图必须是图片文件");
    const forms = await db.select().from(characterForms).where(eq(characterForms.characterId, characterId)).orderBy(characterForms.createdAt);
    let targetForm = typeof body.formId === "string"
      ? forms.find((form) => form.id === body.formId) ?? null
      : forms.find((form) => form.name === "基础形象") ?? forms[0] ?? null;
    if (typeof body.formId === "string" && !targetForm) return errorResponse(404, "CHARACTER_FORM_NOT_FOUND", "角色形态不存在");
    if (!targetForm) {
      targetForm = {
        id: crypto.randomUUID(),
        characterId,
        name: "基础形象",
        description: "角色跨镜头一致性的基础视觉形态",
        assetId: concept.id,
        episodeScopeJson: "[]",
        inheritVoice: true,
        createdAt: updatedAt,
        updatedAt,
      };
      await db.insert(characterForms).values(targetForm);
    } else {
      await db.update(characterForms).set({ assetId: concept.id, updatedAt }).where(eq(characterForms.id, targetForm.id));
    }
    const syncCharacterAsset = targetForm.name === "基础形象" || targetForm.name === "默认形象" || !previous.assetId;
    if (syncCharacterAsset) update.assetId = concept.id;
    await db.update(assets).set({
      assetType: "character",
      metadataJson: updateVisualAssetApproval(concept.metadataJson, false),
      updatedAt,
    }).where(eq(assets.id, concept.id));
  } else if (body.assetId === null) {
    update.assetId = null;
  }
  await db.update(characters).set(update).where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)));
  const saved = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  const voiceChanged = saved[0] && (
    saved[0].voiceAssetId !== previous.voiceAssetId
    || saved[0].voiceDescription !== previous.voiceDescription
    || saved[0].voiceLocked !== previous.voiceLocked
  );
  if (voiceChanged) {
    await invalidateCharacterVoice({ projectId, characterId, voiceReferenceAssetId: saved[0].voiceAssetId, updatedAt });
  }
  if (typeof body.assetId === "string" && body.assetId !== previous.assetId) {
    await invalidateVisualDependencyOutputs(projectId, { characterIds: [characterId] }, updatedAt);
  }
  return json({ character: saved[0] });
}
