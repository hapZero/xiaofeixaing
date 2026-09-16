import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../db";
import { assets, episodes, episodeVersions, mediaJobs, projects, segments, storyBibles } from "../../../../../db/schema";
import { episodeRenderMatchesCurrentSegments } from "../../../../lib/project-delivery";
import { errorResponse, json } from "../../../../lib/server/http";
import { recoverInterruptedMediaJobs } from "../../../../lib/server/media-job-recovery";
import { archiveProjectDelivery, type ProjectDeliveryEntry } from "../../../../lib/server/media-worker";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };

function safeName(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").slice(0, 100);
  return cleaned || fallback;
}

function parseResult(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

async function exportContext(projectId: string) {
  const projectEpisodes = await getDb().select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber);
  const bible = (await getDb().select({ sourceRevision: storyBibles.sourceRevision }).from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0] ?? null;
  const currentSourceRevision = bible?.sourceRevision ?? 1;
  const episodeIds = projectEpisodes.map((episode) => episode.id);
  const [projectSegments, versions] = await Promise.all([
    episodeIds.length ? getDb().select().from(segments).where(and(inArray(segments.episodeId, episodeIds), eq(segments.sourceRevision, currentSourceRevision))).orderBy(segments.sequence) : Promise.resolve([]),
    episodeIds.length ? getDb().select().from(episodeVersions).where(inArray(episodeVersions.episodeId, episodeIds)) : Promise.resolve([]),
  ]);
  const assetIds = [...new Set(projectEpisodes.flatMap((episode) => [episode.videoAssetId, episode.subtitleAssetId].filter((id): id is string => Boolean(id))))];
  const currentAssets = assetIds.length
    ? await getDb().select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, assetIds)))
    : [];
  const missingEpisodes = projectEpisodes.filter((episode) => {
    if (!episode.videoAssetId) return true;
    const asset = currentAssets.find((item) => item.id === episode.videoAssetId);
    if (!asset?.storageKey || asset.status !== "ready") return true;
    const version = versions.find((item) => item.episodeId === episode.id && item.versionNumber === episode.currentVersionNumber);
    if (!version || version.resultAssetId !== episode.videoAssetId) return true;
    const currentSegmentAssetIds = projectSegments
      .filter((segment) => segment.episodeId === episode.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((segment) => segment.videoAssetId);
    return !episodeRenderMatchesCurrentSegments(currentSegmentAssetIds, version.inputsJson);
  });
  return { projectEpisodes, currentAssets, missingEpisodes };
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "project", entityId: projectId, operation: "project_export" });
  const context = await exportContext(projectId);
  const jobs = await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "project"),
    eq(mediaJobs.entityId, projectId),
    eq(mediaJobs.operation, "project_export"),
  )).orderBy(desc(mediaJobs.createdAt)).limit(20);
  const records = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    result: parseResult(job.resultJson),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  }));
  return json({
    readiness: !context.projectEpisodes.length ? "empty" : !["rendered", "delivered"].includes(project.status) || context.missingEpisodes.length ? "blocked" : "ready",
    blockedReason: !["rendered", "delivered"].includes(project.status) ? "项目内容或片段版本已经变化，需要重新完成当前分集成片" : null,
    episodeCount: context.projectEpisodes.length,
    readyEpisodeCount: context.projectEpisodes.length - context.missingEpisodes.length,
    missingEpisodes: context.missingEpisodes.map((episode) => ({ id: episode.id, episodeNumber: episode.episodeNumber, title: episode.title })),
    activeJob: records.find((record) => ["queued", "running"].includes(record.status)) ?? null,
    records,
  });
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  if (!["rendered", "delivered"].includes(project.status)) return errorResponse(409, "PROJECT_RENDER_REQUIRED", "项目内容或片段版本已经变化，请先重新完成所有分集成片再导出");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "project", entityId: projectId, operation: "project_export" });
  const active = (await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "project"),
    eq(mediaJobs.entityId, projectId),
    eq(mediaJobs.operation, "project_export"),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (active) return json({ job: active, reused: true }, { status: 202 });

  const context = await exportContext(projectId);
  if (!context.projectEpisodes.length) return errorResponse(409, "PROJECT_EPISODES_REQUIRED", "项目还没有分集，无法导出整部短剧");
  if (context.missingEpisodes.length) return errorResponse(409, "PROJECT_EPISODES_INCOMPLETE", "请先完成所有分集成片", {
    episodes: context.missingEpisodes.map((episode) => ({ id: episode.id, episodeNumber: episode.episodeNumber, title: episode.title })),
  });

  const entries: ProjectDeliveryEntry[] = [];
  for (const episode of context.projectEpisodes) {
    const prefix = `第${String(episode.episodeNumber).padStart(2, "0")}集-${safeName(episode.title, "未命名")}-v${episode.currentVersionNumber}`;
    const video = context.currentAssets.find((asset) => asset.id === episode.videoAssetId);
    if (!video?.storageKey) return errorResponse(409, "EPISODE_MEDIA_MISSING", `第 ${episode.episodeNumber} 集成片文件不存在，请重新合成`);
    entries.push({ asset: video, name: `成片/${prefix}.mp4`, mediaType: "video", episodeId: episode.id, episodeNumber: episode.episodeNumber, versionNumber: episode.currentVersionNumber });
    const subtitle = context.currentAssets.find((asset) => asset.id === episode.subtitleAssetId);
    if (subtitle?.storageKey) entries.push({ asset: subtitle, name: `字幕/${prefix}.srt`, mediaType: "subtitle", episodeId: episode.id, episodeNumber: episode.episodeNumber, versionNumber: episode.currentVersionNumber });
  }

  const jobId = crypto.randomUUID();
  const startedAt = new Date();
  const versionSnapshot = context.projectEpisodes.map((episode) => ({ episodeId: episode.id, episodeNumber: episode.episodeNumber, title: episode.title, versionNumber: episode.currentVersionNumber, videoAssetId: episode.videoAssetId, subtitleAssetId: episode.subtitleAssetId }));
  await getDb().insert(mediaJobs).values({
    id: jobId,
    ownerId: user.id,
    projectId,
    entityType: "project",
    entityId: projectId,
    operation: "project_export",
    status: "running",
    progress: 5,
    payloadJson: JSON.stringify({ versionSnapshot }),
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  waitUntil((async () => {
    try {
      await getDb().update(mediaJobs).set({ progress: 20, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
      const archived = await archiveProjectDelivery({
        delivery: {
          format: "xiaofeixiang-project-delivery/v1",
          project: { id: project.id, title: project.title, stylePreset: project.stylePreset, aspectRatio: project.aspectRatio },
          exportedAt: new Date().toISOString(),
          episodes: versionSnapshot,
        },
        entries,
      });
      await getDb().update(mediaJobs).set({ progress: 85, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
      if (archived.bytes.byteLength < 100 || new Uint8Array(archived.bytes)[0] !== 0x50 || new Uint8Array(archived.bytes)[1] !== 0x4b) throw new Error("PROJECT_EXPORT_INVALID_ZIP");
      const latestContext = await exportContext(projectId);
      const inputsUnchanged = !latestContext.missingEpisodes.length && versionSnapshot.every((snapshot) => {
        const episode = latestContext.projectEpisodes.find((item) => item.id === snapshot.episodeId);
        return episode?.currentVersionNumber === snapshot.versionNumber
          && episode.videoAssetId === snapshot.videoAssetId
          && episode.subtitleAssetId === snapshot.subtitleAssetId;
      });
      if (!inputsUnchanged || latestContext.projectEpisodes.length !== versionSnapshot.length) throw new Error("PROJECT_EXPORT_INPUTS_CHANGED");
      const assetId = crypto.randomUUID();
      const archiveName = `${safeName(project.title, "小飞象短剧")}-整剧交付-${startedAt.toISOString().slice(0, 10)}.zip`;
      const storageKey = `rendered/${user.id}/${projectId}/exports/${assetId}.zip`;
      await getMediaBucket().put(storageKey, archived.bytes, { httpMetadata: { contentType: archived.contentType, contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}` } });
      const finishedAt = new Date();
      await getDb().insert(assets).values({
        id: assetId,
        projectId,
        episodeId: null,
        assetType: "project_export",
        name: archiveName,
        status: "ready",
        storageKey,
        thumbnailUrl: `/api/assets/${assetId}/content`,
        metadataJson: JSON.stringify({ mediaJobId: jobId, entryCount: archived.entryCount, size: archived.bytes.byteLength, delivery: archived.delivery }),
        createdAt: finishedAt,
        updatedAt: finishedAt,
      });
      const result = { assetId, url: `/api/assets/${assetId}/content`, name: archiveName, size: archived.bytes.byteLength, entryCount: archived.entryCount, episodeCount: context.projectEpisodes.length };
      await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify(result), finishedAt, updatedAt: finishedAt }).where(eq(mediaJobs.id, jobId));
      await getDb().update(projects).set({ status: "delivered", updatedAt: finishedAt }).where(eq(projects.id, projectId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "PROJECT_EXPORT_FAILED";
      const message = reason === "PROJECT_EXPORT_INPUTS_CHANGED" ? "分集版本在打包期间发生变化，本次过期交付未保存；请按当前版本重新导出" : reason;
      const failedAt = new Date();
      await getDb().update(mediaJobs).set({ status: "failed", errorCode: reason.split(":")[0], errorMessage: message, finishedAt: failedAt, updatedAt: failedAt }).where(eq(mediaJobs.id, jobId));
    }
  })());
  return json({ job: { id: jobId, status: "running", progress: 5 }, message: "整剧交付任务已提交，可关闭页面后稍后继续下载" }, { status: 202 });
}
