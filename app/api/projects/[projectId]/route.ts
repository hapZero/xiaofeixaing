import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../db";
import {
  assets,
  audioPresets,
  audioTracks,
  characterFormReferences,
  characterForms,
  characters,
  dialogueLines,
  episodes,
  episodeVersions,
  generationJobs,
  projects,
  segments,
  segmentVersions,
  shotAssetReferences,
  shots,
  shotVersions,
  storyBibles,
  storyScenes,
} from "../../../../db/schema";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getOwnedProject } from "../../../lib/server/project-access";
import { getRequestUser } from "../../../lib/server/request-user";
import { recoverInterruptedTextJobs } from "../../../lib/server/text-job-recovery";

type RouteContext = { params: Promise<{ projectId: string }> };
type UpdateProjectBody = Partial<{ title: string; stylePreset: string; aspectRatio: string; synopsis: string }>;

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  let project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  await recoverInterruptedTextJobs(user.id, projectId);
  project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const [projectEpisodes, projectAssets, projectCharacters, projectAudioPresets, projectStoryBible, projectStoryScenes, projectGenerationJobs] = await Promise.all([
    db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(audioPresets).where(eq(audioPresets.projectId, projectId)),
    db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1),
    db.select().from(storyScenes).where(eq(storyScenes.projectId, projectId)),
    db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)).limit(50),
  ]);
  const currentSourceRevision = projectStoryBible[0]?.sourceRevision ?? 1;
  const activeProjectAssets = projectAssets.filter((asset) => asset.sourceRevision === null || asset.sourceRevision === currentSourceRevision);
  const activeAssetIds = new Set(activeProjectAssets.map((asset) => asset.id));
  const activeProjectCharacters = projectCharacters.filter((character) => !character.assetId || activeAssetIds.has(character.assetId));
  const activeProjectStoryScenes = projectStoryScenes.filter((scene) => !scene.assetId || activeAssetIds.has(scene.assetId));
  const episodeShots = projectEpisodes.length
    ? (await Promise.all(projectEpisodes.map((episode) => db.select().from(shots).where(and(eq(shots.episodeId, episode.id), eq(shots.sourceRevision, currentSourceRevision))).orderBy(shots.sequence)))).flat()
    : [];
  const episodeIds = projectEpisodes.map((episode) => episode.id);
  const shotIds = episodeShots.map((shot) => shot.id);
  const characterIds = activeProjectCharacters.map((character) => character.id);
  const [projectSegments, projectAudioTracks, projectCharacterForms, projectShotReferences, projectDialogueLines, projectShotVersions] = await Promise.all([
    episodeIds.length ? db.select().from(segments).where(and(inArray(segments.episodeId, episodeIds), eq(segments.sourceRevision, currentSourceRevision))).orderBy(segments.sequence) : Promise.resolve([]),
    episodeIds.length ? db.select().from(audioTracks).where(inArray(audioTracks.episodeId, episodeIds)).orderBy(audioTracks.startMs) : Promise.resolve([]),
    characterIds.length ? db.select().from(characterForms).where(inArray(characterForms.characterId, characterIds)) : Promise.resolve([]),
    shotIds.length ? db.select().from(shotAssetReferences).where(inArray(shotAssetReferences.shotId, shotIds)).orderBy(shotAssetReferences.referenceOrder) : Promise.resolve([]),
    shotIds.length ? db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)).orderBy(dialogueLines.sequence) : Promise.resolve([]),
    shotIds.length ? db.select().from(shotVersions).where(inArray(shotVersions.shotId, shotIds)).orderBy(shotVersions.versionNumber) : Promise.resolve([]),
  ]);
  const segmentIds = projectSegments.map((segment) => segment.id);
  const characterFormIds = projectCharacterForms.map((form) => form.id);
  const projectCharacterFormReferences = characterFormIds.length ? await db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, characterFormIds)).orderBy(characterFormReferences.referenceOrder) : [];
  const projectSegmentVersions = segmentIds.length ? await db.select().from(segmentVersions).where(inArray(segmentVersions.segmentId, segmentIds)).orderBy(segmentVersions.versionNumber) : [];
  const projectEpisodeVersions = episodeIds.length ? await db.select().from(episodeVersions).where(inArray(episodeVersions.episodeId, episodeIds)).orderBy(episodeVersions.versionNumber) : [];
  return json({
    project,
    storyBible: projectStoryBible[0] ?? null,
    episodes: projectEpisodes,
    storyScenes: activeProjectStoryScenes,
    segments: projectSegments,
    assets: activeProjectAssets,
    characters: activeProjectCharacters,
    characterForms: projectCharacterForms,
    characterFormReferences: projectCharacterFormReferences,
    audioPresets: projectAudioPresets,
    shots: episodeShots,
    shotAssetReferences: projectShotReferences,
    dialogueLines: projectDialogueLines,
    audioTracks: projectAudioTracks,
    shotVersions: projectShotVersions,
    segmentVersions: projectSegmentVersions,
    episodeVersions: projectEpisodeVersions,
    generationJobs: projectGenerationJobs,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdateProjectBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const update: UpdateProjectBody & { updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim().slice(0, 80);
  if (typeof body.stylePreset === "string") update.stylePreset = body.stylePreset.trim();
  if (typeof body.aspectRatio === "string") update.aspectRatio = body.aspectRatio.trim();
  if (typeof body.synopsis === "string") update.synopsis = body.synopsis.trim();
  await getDb().update(projects).set(update).where(eq(projects.id, projectId));
  const project = await getOwnedProject(projectId, user.id);
  return json({ project });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) {
    return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  }
  const db = getDb();
  const storedAssets = await db.select({ storageKey: assets.storageKey }).from(assets).where(eq(assets.projectId, projectId));
  const storageKeys = [...new Set(storedAssets.map((asset) => asset.storageKey).filter((key): key is string => Boolean(key)))];
  const bucket = getMediaBucket();
  for (let index = 0; index < storageKeys.length; index += 500) await bucket.delete(storageKeys.slice(index, index + 500));
  await db.delete(projects).where(eq(projects.id, projectId));
  return new Response(null, { status: 204 });
}
