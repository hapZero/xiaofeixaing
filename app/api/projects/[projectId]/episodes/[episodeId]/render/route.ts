import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../../../db";
import { assets, characters, dialogueLines, episodeVersions, episodes, mediaJobs, projects, segments, segmentVersions, shots, storyBibles } from "../../../../../../../db/schema";
import { buildEpisodeRenderSnapshot, episodeRenderSnapshotMatches, orderCurrentEpisodeShots } from "../../../../../../lib/episode-render-selection";
import { segmentVersionApprovedForEpisodeRender } from "../../../../../../lib/segment-version";
import { errorResponse, json, readJson } from "../../../../../../lib/server/http";
import { burnEpisodeSubtitles, composeEpisodeVideos } from "../../../../../../lib/server/media-worker";
import { inspectMp4DurationSeconds } from "../../../../../../lib/server/comfyui";
import { recoverInterruptedMediaJobs } from "../../../../../../lib/server/media-job-recovery";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { markEpisodeRenderFailed, markEpisodeRenderStarted, refreshProjectRenderStatus } from "../../../../../../lib/server/production-state";
import { getRequestUser } from "../../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; episodeId: string }> };
type SubtitleStyle = "short_drama" | "cinematic" | "minimal";
type RenderBody = { subtitleStyle?: SubtitleStyle };

function dimensions(aspectRatio: string) {
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1280, height: 720 };
}

function subtitleTime(milliseconds: number) {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const ms = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function loadEpisode(projectId: string, episodeId: string) {
  const episode = (await getDb().select().from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId))).limit(1))[0] ?? null;
  if (!episode) return null;
  const bible = (await getDb().select({ sourceRevision: storyBibles.sourceRevision }).from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0] ?? null;
  const episodeSegments = await getDb().select().from(segments).where(and(eq(segments.episodeId, episodeId), eq(segments.sourceRevision, bible?.sourceRevision ?? 1))).orderBy(segments.sequence);
  return { episode, segments: episodeSegments };
}

async function qualityPending(episodeSegments: Array<typeof segments.$inferSelect>) {
  const segmentIds = episodeSegments.map((segment) => segment.id);
  const versions = segmentIds.length ? await getDb().select().from(segmentVersions).where(inArray(segmentVersions.segmentId, segmentIds)) : [];
  return episodeSegments.filter((segment) => {
    const version = versions.find((item) => item.segmentId === segment.id && item.versionNumber === segment.currentVersionNumber);
    if (!version) return true;
    return !segmentVersionApprovedForEpisodeRender(version.qualityJson, version.status);
  });
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await loadEpisode(projectId, episodeId);
  if (!context) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "episode", entityId: episodeId, operation: "episode_render" });
  const missingSegments = context.segments.filter((segment) => !segment.videoAssetId);
  const pendingQuality = await qualityPending(context.segments.filter((segment) => Boolean(segment.videoAssetId)));
  const latestJob = (await getDb().select().from(mediaJobs).where(and(eq(mediaJobs.ownerId, user.id), eq(mediaJobs.entityType, "episode"), eq(mediaJobs.entityId, episodeId), eq(mediaJobs.operation, "episode_render"))).orderBy(desc(mediaJobs.createdAt)).limit(1))[0] ?? null;
  const versions = await getDb().select().from(episodeVersions).where(eq(episodeVersions.episodeId, episodeId)).orderBy(desc(episodeVersions.versionNumber));
  return json({
    episode: context.episode,
    readiness: missingSegments.length ? "blocked" : pendingQuality.length ? "quality_required" : context.segments.length ? "ready" : "empty",
    missingSegments: missingSegments.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title, status: segment.status })),
    qualityPendingSegments: pendingQuality.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title, status: segment.status })),
    timeline: context.segments.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title, durationMs: segment.durationMs, status: segment.status, videoAssetId: segment.videoAssetId, currentVersionNumber: segment.currentVersionNumber })),
    activeJob: latestJob && ["queued", "running"].includes(latestJob.status) ? latestJob : null,
    lastFailure: latestJob?.status === "failed" ? { code: latestJob.errorCode, message: latestJob.errorMessage } : null,
    versions,
  });
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<RenderBody>(request);
  const subtitleStyle: SubtitleStyle = ["short_drama", "cinematic", "minimal"].includes(body?.subtitleStyle ?? "") ? body!.subtitleStyle! : "short_drama";
  const context = await loadEpisode(projectId, episodeId);
  if (!context) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "episode", entityId: episodeId, operation: "episode_render" });
  if (!context.segments.length) return errorResponse(409, "EPISODE_SEGMENTS_REQUIRED", "本集还没有片段");
  const missingSegments = context.segments.filter((segment) => !segment.videoAssetId);
  if (missingSegments.length) return errorResponse(409, "EPISODE_SEGMENTS_INCOMPLETE", "请先完成本集所有片段视频", { segments: missingSegments.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title })) });
  const pendingQuality = await qualityPending(context.segments);
  if (pendingQuality.length) return errorResponse(409, "SEGMENT_REVIEW_REQUIRED", "请先审看并确认本集所有片段；AI 连续性质检为可选辅助", { segments: pendingQuality.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title })) });
  const active = (await getDb().select().from(mediaJobs).where(and(eq(mediaJobs.ownerId, user.id), eq(mediaJobs.entityType, "episode"), eq(mediaJobs.entityId, episodeId), eq(mediaJobs.operation, "episode_render"), inArray(mediaJobs.status, ["queued", "running"]))).limit(1))[0];
  if (active) return json({ job: active, reused: true }, { status: 202 });

  const segmentSelections = buildEpisodeRenderSnapshot(context.segments);
  const videoAssetIds = segmentSelections.map((selection) => selection.assetId);
  const videoAssets = await getDb().select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, videoAssetIds)));
  const orderedVideos = videoAssetIds.map((id) => videoAssets.find((asset) => asset.id === id)).filter((asset): asset is typeof assets.$inferSelect => Boolean(asset?.storageKey));
  if (orderedVideos.length !== context.segments.length) return errorResponse(409, "EPISODE_MEDIA_MISSING", "部分片段视频文件已经丢失，请重新生成对应片段");

  const jobId = crypto.randomUUID();
  const now = new Date();
  await getDb().insert(mediaJobs).values({ id: jobId, ownerId: user.id, projectId, entityType: "episode", entityId: episodeId, operation: "episode_render", status: "running", progress: 5, payloadJson: JSON.stringify({ segmentSelections, segmentAssetIds: videoAssetIds, aspectRatio: project.aspectRatio, subtitleStyle }), startedAt: now, createdAt: now, updatedAt: now });
  await markEpisodeRenderStarted(projectId, episodeId, now);
  waitUntil((async () => {
    try {
    const currentSegmentIds = context.segments.map((segment) => segment.id);
    const currentShots = currentSegmentIds.length
      ? await getDb().select().from(shots).where(inArray(shots.segmentId, currentSegmentIds))
      : [];
    const episodeShots = orderCurrentEpisodeShots(context.segments, currentShots);
    const shotIds = episodeShots.map((shot) => shot.id);
    const lines = shotIds.length ? await getDb().select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)).orderBy(dialogueLines.sequence) : [];
    const characterIds = [...new Set(lines.flatMap((line) => line.speakerCharacterId ? [line.speakerCharacterId] : []))];
    const speakers = characterIds.length ? await getDb().select().from(characters).where(and(eq(characters.projectId, projectId), inArray(characters.id, characterIds))) : [];
    let cursorMs = 0;
    let cue = 0;
    const subtitles: string[] = [];
    for (const shot of episodeShots) {
      const shotLines = lines.filter((line) => line.shotId === shot.id);
      const lineDuration = Math.max(600, Math.floor(shot.durationMs / Math.max(1, shotLines.length)));
      shotLines.forEach((line, index) => {
        const start = cursorMs + index * lineDuration;
        const end = Math.min(cursorMs + shot.durationMs, start + lineDuration);
        const speaker = speakers.find((item) => item.id === line.speakerCharacterId)?.canonicalName ?? (line.lineType === "narration" ? "旁白" : "画外音");
        subtitles.push(`${++cue}\n${subtitleTime(start)} --> ${subtitleTime(end)}\n${speaker}：${line.text}\n`);
      });
      cursorMs += shot.durationMs;
    }
    await getDb().update(mediaJobs).set({ progress: 20, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
    const composed = await composeEpisodeVideos({ videos: orderedVideos, ...dimensions(project.aspectRatio) });
    await getDb().update(mediaJobs).set({ progress: subtitles.length ? 70 : 85, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
    const subtitleText = subtitles.join("\n");
    const finalVideo = subtitleText
      ? await burnEpisodeSubtitles({ videoBytes: composed.bytes, videoContentType: composed.contentType, subtitles: subtitleText, style: subtitleStyle })
      : composed;
    const durationSeconds = inspectMp4DurationSeconds(finalVideo.bytes);
    const expectedDurationSeconds = cursorMs / 1_000;
    if (!durationSeconds || durationSeconds < 0.1) throw new Error(`EPISODE_VIDEO_INVALID:${durationSeconds ?? 0}s`);
    if (durationSeconds < expectedDurationSeconds * 0.5) throw new Error(`EPISODE_VIDEO_TOO_SHORT:${durationSeconds.toFixed(2)}s/${expectedDurationSeconds.toFixed(2)}s`);
    const latestContext = await loadEpisode(projectId, episodeId);
    const latestSegmentSelections = buildEpisodeRenderSnapshot(latestContext?.segments ?? []);
    if (!episodeRenderSnapshotMatches(latestSegmentSelections, segmentSelections)) {
      throw new Error("EPISODE_INPUTS_CHANGED");
    }
    const latestVersion = (await getDb().select({ versionNumber: episodeVersions.versionNumber }).from(episodeVersions).where(eq(episodeVersions.episodeId, episodeId)).orderBy(desc(episodeVersions.versionNumber)).limit(1))[0];
    const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
    const videoId = crypto.randomUUID();
    const videoKey = `rendered/${user.id}/${projectId}/episodes/${episodeId}/${videoId}.mp4`;
    await getMediaBucket().put(videoKey, finalVideo.bytes, { httpMetadata: { contentType: finalVideo.contentType } });
    const subtitleId = subtitles.length ? crypto.randomUUID() : null;
    const finishedAt = new Date();
    if (subtitleId) {
      await getMediaBucket().put(`rendered/${user.id}/${projectId}/episodes/${episodeId}/${subtitleId}.srt`, new TextEncoder().encode(subtitleText), { httpMetadata: { contentType: "application/x-subrip; charset=utf-8" } });
    }
    await getDb().insert(assets).values({ id: videoId, projectId, episodeId, assetType: "episode_video", name: `第${context.episode.episodeNumber}集-v${versionNumber}.mp4`, status: "ready", storageKey: videoKey, thumbnailUrl: `/api/assets/${videoId}/content`, metadataJson: JSON.stringify({ mediaJobId: jobId, segmentSelections, segmentAssetIds: videoAssetIds, durationMs: cursorMs, durationSeconds, expectedDurationSeconds, subtitlesBurned: Boolean(subtitleText), subtitleStyle }), createdAt: finishedAt, updatedAt: finishedAt });
    if (subtitleId) await getDb().insert(assets).values({ id: subtitleId, projectId, episodeId, assetType: "episode_subtitles", name: `第${context.episode.episodeNumber}集.srt`, status: "ready", storageKey: `rendered/${user.id}/${projectId}/episodes/${episodeId}/${subtitleId}.srt`, thumbnailUrl: `/api/assets/${subtitleId}/content`, metadataJson: JSON.stringify({ mediaJobId: jobId, cueCount: cue }), createdAt: finishedAt, updatedAt: finishedAt });
    await getDb().insert(episodeVersions).values({ id: crypto.randomUUID(), episodeId, versionNumber, resultAssetId: videoId, subtitleAssetId: subtitleId, durationMs: cursorMs, inputsJson: JSON.stringify({ segmentSelections, segmentAssetIds: videoAssetIds, subtitleStyle, subtitlesBurned: Boolean(subtitleText) }), status: "ready", createdAt: finishedAt });
    await getDb().update(episodes).set({ videoAssetId: videoId, subtitleAssetId: subtitleId, currentVersionNumber: versionNumber, status: "rendered", updatedAt: finishedAt }).where(eq(episodes.id, episodeId));
    await refreshProjectRenderStatus(projectId, finishedAt);
    const result = { videoAssetId: videoId, videoUrl: `/api/assets/${videoId}/content`, subtitleAssetId: subtitleId, subtitleUrl: subtitleId ? `/api/assets/${subtitleId}/content` : null, versionNumber, durationMs: cursorMs };
    await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify(result), finishedAt, updatedAt: finishedAt }).where(eq(mediaJobs.id, jobId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "EPISODE_RENDER_FAILED";
      const message = reason === "EPISODE_INPUTS_CHANGED" ? "片段版本在合成期间发生变化，本次过期任务未采用；请按当前片段版本重新合成" : reason;
      const failedAt = new Date();
      await getDb().update(mediaJobs).set({ status: "failed", errorCode: reason.split(":")[0], errorMessage: message, finishedAt: failedAt, updatedAt: failedAt }).where(eq(mediaJobs.id, jobId));
      await markEpisodeRenderFailed(projectId, episodeId, failedAt);
    }
  })());
  return json({ job: { id: jobId, status: "running", progress: 5 }, message: "整集合成任务已提交，可关闭页面后稍后继续查看" }, { status: 202 });
}
