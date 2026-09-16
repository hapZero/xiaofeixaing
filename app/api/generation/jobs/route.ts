import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { assets, characterFormReferences, characterForms, characters, generationJobs, segments, shots } from "../../../../db/schema";
import { GenerationSubmissionError, submitGenerationJobForUser, type SubmitGenerationJobInput } from "../../../lib/server/generation-submit";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getOwnedProject } from "../../../lib/server/project-access";
import { buildStoryboardFramePrompt, type StoryboardFrameIdentity } from "../../../lib/server/segment-prompt";
import { buildCharacterReferenceCatalog, buildGenerationReferencePayload, buildShotReferenceContext, loadEffectiveSegmentReferences, referencesForShot, type EffectiveSegmentReference } from "../../../lib/server/segment-references";
import { buildShotVideoJobPayload, parseShotGenerationPlan, readShotVideoCapabilitySelection, shotVideoGenerationBlockers } from "../../../lib/shot-video-capability";
import type { WorkflowCapability } from "../../../lib/workflow-capabilities";
import { getRequestUser } from "../../../lib/server/request-user";
import { visualAssetMediaReady, visualAssetProductionReady } from "../../../lib/visual-asset-approval";

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

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId || !await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const jobs = await getDb().select().from(generationJobs).where(and(eq(generationJobs.ownerId, user.id), eq(generationJobs.projectId, projectId))).orderBy(desc(generationJobs.createdAt)).limit(100);
  return json({ jobs });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await readJson<SubmitGenerationJobInput>(request);
  if (!body) return errorResponse(400, "INVALID_JOB", "生成任务参数不完整");
  const project = await getOwnedProject(body.projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  try {
    if (body.entityType === "shot" && ["storyboard_frame", "image_to_video", "multi_subject_video", "first_last_frame_video", "native_audio_video"].includes(body.capability)) {
      const db = getDb();
      const shot = (await db.select().from(shots).where(eq(shots.id, body.entityId)).limit(1))[0];
      const segment = shot?.segmentId ? (await db.select().from(segments).where(eq(segments.id, shot.segmentId)).limit(1))[0] : null;
      if (shot && segment) {
        const segmentShots = await db.select({ id: shots.id }).from(shots).where(eq(shots.segmentId, segment.id));
        const references = await loadEffectiveSegmentReferences(segment.id, segmentShots.map((item) => item.id), segment.referenceMode);
        const [projectCharacters, formRows] = await Promise.all([
          db.select().from(characters).where(eq(characters.projectId, body.projectId)),
          db.select().from(characterForms).innerJoin(characters, eq(characters.id, characterForms.characterId)).where(eq(characters.projectId, body.projectId)),
        ]);
        const forms = formRows.map((row) => row.character_forms);
        const characterCatalog = buildCharacterReferenceCatalog(projectCharacters, forms);
        const shotReferences = referencesForShot(references, shot.id, buildShotReferenceContext({
          shot,
          characters: projectCharacters,
          characterCatalog,
        }));
        const formIds = [...new Set(shotReferences.flatMap((reference) => reference.characterFormId ? [reference.characterFormId] : []))];
        const formReferenceImages = formIds.length ? await db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, formIds)) : [];
        const referencePayload = buildGenerationReferencePayload(shotReferences, formReferenceImages);
        const referencedAssets = referencePayload.referenceAssetIds.length
          ? await db.select().from(assets).where(and(eq(assets.projectId, body.projectId), inArray(assets.id, referencePayload.referenceAssetIds)))
          : [];
        const missingMedia = referencePayload.referenceAssetIds.filter((assetId) => !visualAssetMediaReady(referencedAssets.find((asset) => asset.id === assetId)));
        const unlockedReferences = shotReferences.filter((reference) => reference.required && !visualAssetProductionReady(referencedAssets.find((asset) => asset.id === reference.assetId)));
        if (missingMedia.length || unlockedReferences.length) {
          return errorResponse(409, "ASSETS_REQUIRED", "当前分镜引用的角色、场景或道具必须先生成并锁定", {
            assetIds: missingMedia,
            referenceIds: unlockedReferences.map((reference) => reference.id),
          });
        }

        if (body.capability === "storyboard_frame") {
          const sceneIds = shotReferences.flatMap((reference) => reference.referenceRole === "scene" && reference.assetId ? [reference.assetId] : []);
          const sceneAssets = sceneIds.length ? await db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, sceneIds)) : [];
          body.payload = {
            ...(body.payload ?? {}),
            prompt: buildStoryboardFramePrompt({
              shotPrompt: typeof body.payload?.prompt === "string" && body.payload.prompt.trim() ? body.payload.prompt : shot.prompt,
              stylePreset: project.stylePreset,
              aspectRatio: project.aspectRatio,
              identities: storyboardIdentitiesForShot(shotReferences, projectCharacters, forms),
              sceneName: sceneAssets[0]?.name ?? null,
            }),
            aspectRatio: project.aspectRatio,
            stylePreset: project.stylePreset,
            ...referencePayload,
          };
        } else {
          body.payload = { ...(body.payload ?? {}), ...referencePayload };
          if (["image_to_video", "multi_subject_video", "first_last_frame_video"].includes(body.capability)) {
            const plan = parseShotGenerationPlan(shot.generationPlanJson);
            const capability = readShotVideoCapabilitySelection(plan) as WorkflowCapability;
            const blockers = shotVideoGenerationBlockers({ capability, plan, firstFrameAssetId: shot.firstFrameAssetId });
            if (blockers.length) {
              return errorResponse(409, "SHOT_VIDEO_INPUTS_REQUIRED", `当前分镜还缺少：${blockers.join("、")}`, { blockers, capability });
            }
            body.capability = capability;
            body.payload = buildShotVideoJobPayload({
              shot,
              capability,
              segmentPipeline: (body.payload as Record<string, unknown> | undefined)?.segmentPipeline === true,
              referencePayload: referencePayload as Record<string, unknown>,
            });
          }
        }
      }
    }
    return json({ job: await submitGenerationJobForUser(user.id, body) }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationSubmissionError) return errorResponse(error.status, error.code, error.message, error.details);
    return errorResponse(500, "GENERATION_SUBMIT_FAILED", "生成任务提交失败");
  }
}
