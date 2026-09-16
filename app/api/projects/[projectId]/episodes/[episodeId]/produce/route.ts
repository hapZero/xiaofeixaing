import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { audioPresets, dialogueLines, episodes, mediaJobs, segments, shots, storyBibles } from "../../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; episodeId: string }> };
type BatchAction = { action?: "start" | "attempt" | "advance" | "fail" | "cancel"; segmentId?: string; errorCode?: string; errorMessage?: string };
type BatchPayload = { segmentIds: string[]; currentIndex: number; attemptedSegmentIds: string[]; runnerLeaseToken?: string; runnerLeaseExpiresAt?: number };

const operation = "episode_segment_production";

function parsePayload(value: string): BatchPayload {
  try {
    const parsed = JSON.parse(value) as Partial<BatchPayload>;
    return {
      segmentIds: Array.isArray(parsed.segmentIds) ? parsed.segmentIds.filter((id): id is string => typeof id === "string") : [],
      currentIndex: Math.max(0, Number(parsed.currentIndex) || 0),
      attemptedSegmentIds: Array.isArray(parsed.attemptedSegmentIds) ? parsed.attemptedSegmentIds.filter((id): id is string => typeof id === "string") : [],
      runnerLeaseToken: typeof parsed.runnerLeaseToken === "string" ? parsed.runnerLeaseToken : undefined,
      runnerLeaseExpiresAt: Number.isFinite(Number(parsed.runnerLeaseExpiresAt)) ? Number(parsed.runnerLeaseExpiresAt) : undefined,
    };
  } catch {
    return { segmentIds: [], currentIndex: 0, attemptedSegmentIds: [] };
  }
}

async function episodeContext(projectId: string, episodeId: string) {
  const db = getDb();
  const episode = (await db.select().from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId))).limit(1))[0] ?? null;
  if (!episode) return null;
  const bible = (await db.select({ sourceRevision: storyBibles.sourceRevision }).from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0] ?? null;
  const episodeSegments = await db.select().from(segments).where(and(eq(segments.episodeId, episodeId), eq(segments.sourceRevision, bible?.sourceRevision ?? 1))).orderBy(segments.sequence);
  const segmentIds = episodeSegments.map((segment) => segment.id);
  const episodeShots = segmentIds.length ? await db.select().from(shots).where(inArray(shots.segmentId, segmentIds)).orderBy(shots.sequence) : [];
  const shotIds = episodeShots.map((shot) => shot.id);
  const lines = shotIds.length ? await db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)) : [];
  const presetIds = [...new Set(episodeShots.flatMap((shot) => shot.environmentPresetId ? [shot.environmentPresetId] : []))];
  const presets = presetIds.length ? await db.select().from(audioPresets).where(and(eq(audioPresets.projectId, projectId), inArray(audioPresets.id, presetIds))) : [];
  const lockedPresetIds = new Set(presets.filter((preset) => preset.locked).map((preset) => preset.id));
  const ready = (segment: typeof segments.$inferSelect) => {
    if (!segment.videoAssetId) return false;
    const segmentShotIds = new Set(episodeShots.filter((shot) => shot.segmentId === segment.id).map((shot) => shot.id));
    const requiresVoice = lines.some((line) => segmentShotIds.has(line.shotId));
    const requiresAmbience = episodeShots.some((shot) => shot.segmentId === segment.id && shot.environmentPresetId && lockedPresetIds.has(shot.environmentPresetId));
    return (!requiresVoice && !requiresAmbience) || segment.status === "video_audio_ready";
  };
  return { episode, segments: episodeSegments, ready };
}

async function jobs(ownerId: string, projectId: string, episodeId: string) {
  return getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, ownerId),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "episode"),
    eq(mediaJobs.entityId, episodeId),
    eq(mediaJobs.operation, operation),
  )).orderBy(desc(mediaJobs.createdAt)).limit(20);
}

function responseState(context: NonNullable<Awaited<ReturnType<typeof episodeContext>>>, records: Awaited<ReturnType<typeof jobs>>) {
  const active = records.find((job) => ["queued", "running"].includes(job.status)) ?? null;
  const latest = records[0] ?? null;
  const payload = active ? parsePayload(active.payloadJson) : null;
  const readySegmentIds = context.segments.filter(context.ready).map((segment) => segment.id);
  const currentSegmentId = payload?.segmentIds[payload.currentIndex] ?? null;
  const currentSegment = context.segments.find((segment) => segment.id === currentSegmentId) ?? null;
  return {
    status: active ? "running" : latest?.status === "failed" ? "failed" : latest?.status === "cancelled" ? "cancelled" : readySegmentIds.length === context.segments.length && context.segments.length ? "complete" : "idle",
    batch: active ? { id: active.id, status: active.status, progress: active.progress, currentSegmentId, currentIndex: payload?.currentIndex ?? 0, total: payload?.segmentIds.length ?? context.segments.length, currentAttempted: currentSegmentId ? payload?.attemptedSegmentIds.includes(currentSegmentId) ?? false : false } : null,
    currentSegment: currentSegment ? { id: currentSegment.id, sequence: currentSegment.sequence, title: currentSegment.title, status: currentSegment.status, videoAssetId: currentSegment.videoAssetId } : null,
    progress: { ready: readySegmentIds.length, total: context.segments.length },
    segments: context.segments.map((segment) => ({ id: segment.id, sequence: segment.sequence, title: segment.title, status: segment.status, videoAssetId: segment.videoAssetId, ready: context.ready(segment) })),
    lastFailure: latest?.status === "failed" ? { code: latest.errorCode, message: latest.errorMessage, segmentId: parsePayload(latest.payloadJson).segmentIds[parsePayload(latest.payloadJson).currentIndex] ?? null } : null,
  };
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await episodeContext(projectId, episodeId);
  if (!context) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");
  return json(responseState(context, await jobs(user.id, projectId, episodeId)));
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await episodeContext(projectId, episodeId);
  if (!context) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");
  if (!context.segments.length) return errorResponse(409, "EPISODE_SEGMENTS_REQUIRED", "本集还没有可生产片段");
  const body = await readJson<BatchAction>(request);
  const action = body?.action ?? "start";
  const existing = await jobs(user.id, projectId, episodeId);
  const active = existing.find((job) => ["queued", "running"].includes(job.status)) ?? null;

  if (action === "start") {
    if (active) return json(responseState(context, existing), { status: 202 });
    const firstIncompleteIndex = context.segments.findIndex((segment) => !context.ready(segment));
    if (firstIncompleteIndex < 0) return json(responseState(context, existing));
    const now = new Date();
    await getDb().insert(mediaJobs).values({
      id: crypto.randomUUID(), ownerId: user.id, projectId, entityType: "episode", entityId: episodeId, operation,
      status: "running", progress: Math.round(firstIncompleteIndex / context.segments.length * 100),
      payloadJson: JSON.stringify({ segmentIds: context.segments.map((segment) => segment.id), currentIndex: firstIncompleteIndex, attemptedSegmentIds: [] } satisfies BatchPayload),
      startedAt: now, createdAt: now, updatedAt: now,
    });
    return json(responseState(context, await jobs(user.id, projectId, episodeId)), { status: 202 });
  }

  if (!active) return errorResponse(409, "EPISODE_BATCH_NOT_RUNNING", "当前没有正在执行的分集批次");
  const payload = parsePayload(active.payloadJson);
  const currentSegmentId = payload.segmentIds[payload.currentIndex] ?? null;
  if (body?.segmentId && currentSegmentId !== body.segmentId) return errorResponse(409, "EPISODE_BATCH_SEGMENT_CHANGED", "批次已经推进到其他片段，请刷新状态");

  if (action === "cancel") {
    const now = new Date();
    await getDb().update(mediaJobs).set({ status: "cancelled", errorCode: "USER_CANCELLED", errorMessage: "用户停止了分集批量生产；已完成片段不会被删除", finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, active.id));
    return json(responseState(context, await jobs(user.id, projectId, episodeId)));
  }
  if (action === "fail") {
    const now = new Date();
    await getDb().update(mediaJobs).set({ status: "failed", errorCode: body?.errorCode?.slice(0, 80) || "SEGMENT_PRODUCTION_FAILED", errorMessage: body?.errorMessage?.slice(0, 1_000) || "片段生产失败", finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, active.id));
    return json(responseState(context, await jobs(user.id, projectId, episodeId)));
  }
  if (action === "attempt") {
    if (!currentSegmentId) return errorResponse(409, "EPISODE_BATCH_COMPLETE", "当前批次已经没有待生产片段");
    const now = new Date();
    const attemptedSegmentIds = payload.attemptedSegmentIds.includes(currentSegmentId) ? payload.attemptedSegmentIds : [...payload.attemptedSegmentIds, currentSegmentId];
    await getDb().update(mediaJobs).set({ payloadJson: JSON.stringify({ ...payload, attemptedSegmentIds }), updatedAt: now }).where(eq(mediaJobs.id, active.id));
    return json(responseState(context, await jobs(user.id, projectId, episodeId)), { status: 202 });
  }
  if (action !== "advance") return errorResponse(400, "INVALID_BATCH_ACTION", "不支持的批次操作");

  const currentSegment = context.segments.find((segment) => segment.id === currentSegmentId) ?? null;
  if (!currentSegment || !context.ready(currentSegment)) return errorResponse(409, "SEGMENT_NOT_READY", "当前片段尚未完成视频与必要声音，不能推进批次");
  let nextIndex = payload.currentIndex + 1;
  while (nextIndex < payload.segmentIds.length) {
    const candidate = context.segments.find((segment) => segment.id === payload.segmentIds[nextIndex]);
    if (candidate && !context.ready(candidate)) break;
    nextIndex += 1;
  }
  const now = new Date();
  if (nextIndex >= payload.segmentIds.length) {
    await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify({ segmentIds: payload.segmentIds }), finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, active.id));
  } else {
    await getDb().update(mediaJobs).set({ progress: Math.round(nextIndex / payload.segmentIds.length * 100), payloadJson: JSON.stringify({ ...payload, currentIndex: nextIndex }), updatedAt: now }).where(eq(mediaJobs.id, active.id));
  }
  return json(responseState(context, await jobs(user.id, projectId, episodeId)), { status: nextIndex >= payload.segmentIds.length ? 200 : 202 });
}
