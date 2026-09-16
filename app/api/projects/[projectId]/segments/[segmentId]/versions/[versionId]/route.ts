import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../../../../../../db";
import { assets, dialogueLines, episodes, generationJobs, mediaJobs, segmentVersions, segments, shots } from "../../../../../../../../db/schema";
import { segmentVersionHasFinishedAudio } from "../../../../../../../lib/segment-version";
import { errorResponse, json } from "../../../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../../../lib/server/project-access";
import { setCurrentSegmentVersion } from "../../../../../../../lib/server/production-state";
import { getRequestUser } from "../../../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string; versionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId, versionId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const segment = (await db
    .select({ id: segments.id, episodeId: segments.episodeId, status: segments.status })
    .from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1))[0];
  if (!segment) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或不属于当前项目");
  if (["preparing", "generating", "generating_shots", "composing"].includes(segment.status)) {
    return errorResponse(409, "SEGMENT_BUSY", "片段正在生成，完成后才能切换采用版本");
  }
  const segmentDialogueLineIds = (await db
    .select({ id: dialogueLines.id })
    .from(dialogueLines)
    .innerJoin(shots, eq(shots.id, dialogueLines.shotId))
    .where(eq(shots.segmentId, segmentId)))
    .map((line) => line.id);
  const activeGenerationEntity = segmentDialogueLineIds.length
    ? or(
      and(eq(generationJobs.entityType, "segment"), eq(generationJobs.entityId, segmentId)),
      and(eq(generationJobs.entityType, "dialogue_line"), inArray(generationJobs.entityId, segmentDialogueLineIds)),
    )
    : and(eq(generationJobs.entityType, "segment"), eq(generationJobs.entityId, segmentId));
  const activeGeneration = (await db.select({ id: generationJobs.id }).from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    inArray(generationJobs.status, ["submitting", "queued", "running"]),
    activeGenerationEntity,
  )).limit(1))[0];
  const activeMedia = (await db.select({ id: mediaJobs.id }).from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment"),
    eq(mediaJobs.entityId, segmentId),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeGeneration || activeMedia) {
    return errorResponse(409, "SEGMENT_BUSY", "片段正在生成或合成声音，完成后才能切换采用版本");
  }

  const version = (await db.select().from(segmentVersions).where(and(eq(segmentVersions.id, versionId), eq(segmentVersions.segmentId, segmentId))).limit(1))[0];
  if (!version?.resultAssetId) return errorResponse(409, "SEGMENT_VERSION_NOT_READY", "该候选版本还没有可用的视频结果");
  const asset = (await db.select().from(assets).where(and(eq(assets.id, version.resultAssetId), eq(assets.projectId, projectId))).limit(1))[0];
  if (!asset?.storageKey || asset.status !== "ready") return errorResponse(409, "SEGMENT_VERSION_ASSET_MISSING", "该候选版本的视频文件不存在或尚未归档");

  const updatedAt = new Date();
  await setCurrentSegmentVersion({
    projectId,
    episodeId: segment.episodeId,
    segmentId,
    assetId: asset.id,
    versionNumber: version.versionNumber,
    status: segmentVersionHasFinishedAudio(version.productionMode, version.inputsJson) ? "video_audio_ready" : "video_ready",
    updatedAt,
  });
  const selected = (await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1))[0];
  return json({ segment: selected, version, assetUrl: `/api/assets/${asset.id}/content` });
}
