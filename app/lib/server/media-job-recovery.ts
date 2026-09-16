import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { mediaJobs, segments, segmentVersions } from "../../../db/schema";
import { markEpisodeRenderFailed } from "./production-state";

type RuntimeEnv = { MEDIA_JOB_LEASE_MS?: string };
const DEFAULT_MEDIA_JOB_LEASE_MS = 30 * 60 * 1_000;

function mediaJobLeaseMs() {
  const configured = Number((env as unknown as RuntimeEnv).MEDIA_JOB_LEASE_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_MEDIA_JOB_LEASE_MS;
}

function milliseconds(value: Date | number | string | null) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1_000 : value;
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}

export async function recoverInterruptedMediaJobs(options: {
  ownerId: string;
  projectId: string;
  entityType: "segment" | "segment_version" | "episode" | "project";
  entityId: string;
  operation?: string;
}) {
  const db = getDb();
  const active = await db.select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, options.ownerId),
    eq(mediaJobs.projectId, options.projectId),
    eq(mediaJobs.entityType, options.entityType),
    eq(mediaJobs.entityId, options.entityId),
    ...(options.operation ? [eq(mediaJobs.operation, options.operation)] : []),
    inArray(mediaJobs.status, ["queued", "running"]),
  ));
  const cutoff = Date.now() - mediaJobLeaseMs();
  const interrupted = active.filter((job) => milliseconds(job.updatedAt) <= cutoff);
  if (!interrupted.length) return { recovered: 0 };

  const failedAt = new Date();
  for (const job of interrupted) {
    await db.update(mediaJobs).set({
      status: "failed",
      errorCode: "MEDIA_JOB_INTERRUPTED",
      errorMessage: "媒体任务长时间没有心跳，可能因服务重启或连接中断而停止；可安全重新提交",
      finishedAt: failedAt,
      updatedAt: failedAt,
    }).where(and(eq(mediaJobs.id, job.id), inArray(mediaJobs.status, ["queued", "running"])));
    if (job.entityType === "segment" && job.operation === "segment_shot_compose") {
      await db.update(segments).set({ status: "compose_failed", updatedAt: failedAt }).where(and(eq(segments.id, job.entityId), eq(segments.status, "composing")));
    }
    if (job.entityType === "segment_version" && job.operation === "segment_quality_review") {
      const version = (await db.select().from(segmentVersions).where(eq(segmentVersions.id, job.entityId)).limit(1))[0] ?? null;
      if (version) {
        let quality: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(version.qualityJson) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) quality = parsed as Record<string, unknown>;
        } catch {
          quality = {};
        }
        await db.update(segmentVersions).set({
          status: "review_error",
          qualityJson: JSON.stringify({ ...quality, semantic: { status: "failed", reason: "MEDIA_JOB_INTERRUPTED" }, overall: { status: "review_error", score: 0 }, checkedAt: failedAt.toISOString() }),
        }).where(eq(segmentVersions.id, job.entityId));
      }
    }
    if (job.entityType === "episode" && job.operation === "episode_render") {
      await markEpisodeRenderFailed(options.projectId, job.entityId, failedAt);
    }
  }
  return { recovered: interrupted.length };
}
