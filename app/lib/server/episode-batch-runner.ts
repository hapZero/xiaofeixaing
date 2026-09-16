import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { mediaJobs, users } from "../../../db/schema";
import { GET as syncGenerationJobRoute } from "../../api/generation/jobs/[jobId]/route";
import { GET as readBatchRoute, POST as updateBatchRoute } from "../../api/projects/[projectId]/episodes/[episodeId]/produce/route";
import { GET as readSegmentRoute, POST as submitSegmentRoute } from "../../api/projects/[projectId]/segments/[segmentId]/generate/route";
import { GET as readSoundRoute, POST as submitSoundRoute } from "../../api/projects/[projectId]/segments/[segmentId]/sound/route";

type RunnerUser = { id: string; email: string; displayName: string };
type ActiveBatch = typeof mediaJobs.$inferSelect;
type BatchState = {
  status: string;
  batch: { currentSegmentId: string | null; currentAttempted: boolean } | null;
  currentSegment: { id: string; sequence: number; title: string; status: string; videoAssetId: string | null } | null;
};
type SegmentState = {
  segment?: { id: string; status: string; videoAssetId: string | null };
  stage?: string | null;
  activeJob?: { id: string; capability: string; status: string } | null;
  mediaJob?: { id: string; status: string; progress: number } | null;
  lastFailure?: { errorCode?: string | null; errorMessage?: string | null } | null;
};
type SoundState = {
  status?: "complete" | "running" | "ready_to_continue" | "waiting_video";
  activeJob?: { id: string; capability: string; status: string } | null;
  mediaJob?: { id: string; operation: string; status: string; progress: number; errorMessage?: string | null } | null;
  blockers?: Array<{ name: string; reason: string }>;
};
type LeasePayload = Record<string, unknown> & { runnerLeaseToken?: string; runnerLeaseExpiresAt?: number };

function internalRequest(user: RunnerUser, path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const headers = new Headers({
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.displayName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://internal.xiaofeixiang.local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function routeJson<T>(response: Response): Promise<{ ok: boolean; status: number; data: T & { error?: { code?: string; message?: string } } }> {
  return { ok: response.ok, status: response.status, data: await response.json() as T & { error?: { code?: string; message?: string } } };
}

function batchPath(batch: ActiveBatch) {
  return `/api/projects/${batch.projectId}/episodes/${batch.entityId}/produce`;
}

function leasePayload(value: string): LeasePayload {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as LeasePayload : {};
  } catch {
    return {};
  }
}

async function claimBatch(batch: ActiveBatch) {
  const current = leasePayload(batch.payloadJson);
  if (Number(current.runnerLeaseExpiresAt) > Date.now()) return null;
  const token = crypto.randomUUID();
  const payloadJson = JSON.stringify({ ...current, runnerLeaseToken: token, runnerLeaseExpiresAt: Date.now() + 30_000 });
  await getDb().update(mediaJobs).set({ payloadJson, updatedAt: new Date() }).where(and(
    eq(mediaJobs.id, batch.id),
    eq(mediaJobs.payloadJson, batch.payloadJson),
    inArray(mediaJobs.status, ["queued", "running"]),
  ));
  const claimed = (await getDb().select().from(mediaJobs).where(eq(mediaJobs.id, batch.id)).limit(1))[0] ?? null;
  return claimed && leasePayload(claimed.payloadJson).runnerLeaseToken === token ? { batch: claimed, token } : null;
}

async function releaseBatch(batchId: string, token: string) {
  const current = (await getDb().select().from(mediaJobs).where(eq(mediaJobs.id, batchId)).limit(1))[0] ?? null;
  if (!current) return;
  const payload = leasePayload(current.payloadJson);
  if (payload.runnerLeaseToken !== token) return;
  delete payload.runnerLeaseToken;
  delete payload.runnerLeaseExpiresAt;
  await getDb().update(mediaJobs).set({ payloadJson: JSON.stringify(payload), updatedAt: new Date() }).where(and(eq(mediaJobs.id, batchId), eq(mediaJobs.payloadJson, current.payloadJson)));
}

async function failBatch(batch: ActiveBatch, user: RunnerUser, segmentId: string, code: string, message: string) {
  await updateBatchRoute(internalRequest(user, batchPath(batch), "POST", { action: "fail", segmentId, errorCode: code, errorMessage: message }), { params: Promise.resolve({ projectId: batch.projectId, episodeId: batch.entityId }) });
  return { batchId: batch.id, status: "failed", segmentId, code, message };
}

async function syncJob(user: RunnerUser, jobId: string) {
  const result = await routeJson<{ job?: { status?: string; errorCode?: string | null; errorMessage?: string | null } }>(
    await syncGenerationJobRoute(internalRequest(user, `/api/generation/jobs/${jobId}`), { params: Promise.resolve({ jobId }) }),
  );
  return result.data.job ?? null;
}

export async function runEpisodeBatchStep(batch: ActiveBatch, user: RunnerUser) {
  await getDb().update(mediaJobs).set({ updatedAt: new Date() }).where(and(eq(mediaJobs.id, batch.id), inArray(mediaJobs.status, ["queued", "running"])));
  const batchResult = await routeJson<BatchState>(await readBatchRoute(internalRequest(user, batchPath(batch)), { params: Promise.resolve({ projectId: batch.projectId, episodeId: batch.entityId }) }));
  if (!batchResult.ok || batchResult.data.status !== "running" || !batchResult.data.batch?.currentSegmentId) {
    return { batchId: batch.id, status: batchResult.data.status || "inactive" };
  }
  const segmentId = batchResult.data.batch.currentSegmentId;
  const segmentPath = `/api/projects/${batch.projectId}/segments/${segmentId}`;
  const segmentResult = await routeJson<SegmentState>(await readSegmentRoute(internalRequest(user, `${segmentPath}/generate`), { params: Promise.resolve({ projectId: batch.projectId, segmentId }) }));
  if (!segmentResult.ok) return failBatch(batch, user, segmentId, segmentResult.data.error?.code ?? "SEGMENT_STATUS_FAILED", segmentResult.data.error?.message ?? "片段生产状态读取失败");
  const segment = segmentResult.data;
  if (segment.activeJob) {
    const job = await syncJob(user, segment.activeJob.id);
    if (job?.status === "failed") return failBatch(batch, user, segmentId, job.errorCode ?? "GENERATION_FAILED", job.errorMessage ?? "Spark 生成失败");
    return { batchId: batch.id, status: "waiting_generation", segmentId, jobId: segment.activeJob.id };
  }
  if (segment.mediaJob) return { batchId: batch.id, status: "waiting_media", segmentId, mediaJobId: segment.mediaJob.id };

  if (!segment.segment?.videoAssetId) {
    if (batchResult.data.batch.currentAttempted && ["generation_failed", "compose_failed"].includes(segment.segment?.status ?? "")) {
      return failBatch(batch, user, segmentId, segment.lastFailure?.errorCode ?? "SEGMENT_PRODUCTION_FAILED", segment.lastFailure?.errorMessage ?? "片段视频生成失败");
    }
    if (!batchResult.data.batch.currentAttempted) {
      await updateBatchRoute(internalRequest(user, batchPath(batch), "POST", { action: "attempt", segmentId }), { params: Promise.resolve({ projectId: batch.projectId, episodeId: batch.entityId }) });
    }
    const submitted = await routeJson<{ message?: string }>(await submitSegmentRoute(internalRequest(user, `${segmentPath}/generate`, "POST", { force: false, confirmFrames: true }), { params: Promise.resolve({ projectId: batch.projectId, segmentId }) }));
    if (!submitted.ok) return failBatch(batch, user, segmentId, submitted.data.error?.code ?? "SEGMENT_SUBMIT_FAILED", submitted.data.error?.message ?? "片段任务提交失败");
    return { batchId: batch.id, status: "submitted_segment", segmentId, message: submitted.data.message };
  }

  const soundResult = await routeJson<SoundState>(await readSoundRoute(internalRequest(user, `${segmentPath}/sound`), { params: Promise.resolve({ projectId: batch.projectId, segmentId }) }));
  if (!soundResult.ok) return failBatch(batch, user, segmentId, soundResult.data.error?.code ?? "SEGMENT_SOUND_STATUS_FAILED", soundResult.data.error?.message ?? "片段声音状态读取失败");
  const sound = soundResult.data;
  if (sound.activeJob) {
    const job = await syncJob(user, sound.activeJob.id);
    if (job?.status === "failed") return failBatch(batch, user, segmentId, job.errorCode ?? "SEGMENT_SOUND_FAILED", job.errorMessage ?? "片段声音生成失败");
    return { batchId: batch.id, status: "waiting_sound_generation", segmentId, jobId: sound.activeJob.id };
  }
  if (sound.mediaJob?.status === "running") return { batchId: batch.id, status: "waiting_sound_media", segmentId, mediaJobId: sound.mediaJob.id };
  if (sound.mediaJob?.status === "failed" && batchResult.data.batch.currentAttempted) return failBatch(batch, user, segmentId, "SEGMENT_SOUND_FAILED", sound.mediaJob.errorMessage ?? "片段声音处理失败");
  if (sound.blockers?.length) return failBatch(batch, user, segmentId, "SEGMENT_SOUND_BLOCKED", sound.blockers.map((item) => `${item.name}：${item.reason}`).join("；"));
  if (sound.status === "complete") {
    const advanced = await routeJson<BatchState>(await updateBatchRoute(internalRequest(user, batchPath(batch), "POST", { action: "advance", segmentId }), { params: Promise.resolve({ projectId: batch.projectId, episodeId: batch.entityId }) }));
    return { batchId: batch.id, status: advanced.data.status === "complete" ? "complete" : "advanced", segmentId };
  }
  const submitted = await routeJson<{ message?: string }>(await submitSoundRoute(internalRequest(user, `${segmentPath}/sound`, "POST"), { params: Promise.resolve({ projectId: batch.projectId, segmentId }) }));
  if (!submitted.ok) return failBatch(batch, user, segmentId, submitted.data.error?.code ?? "SEGMENT_SOUND_SUBMIT_FAILED", submitted.data.error?.message ?? "声音任务提交失败");
  return { batchId: batch.id, status: "submitted_sound", segmentId, message: submitted.data.message };
}

export async function runActiveEpisodeBatches(limit = 8) {
  const db = getDb();
  const batches = await db.select().from(mediaJobs).where(and(eq(mediaJobs.operation, "episode_segment_production"), inArray(mediaJobs.status, ["queued", "running"]))).limit(Math.max(1, Math.min(32, limit)));
  if (!batches.length) return { active: 0, results: [] };
  const ownerIds = [...new Set(batches.map((batch) => batch.ownerId))];
  const owners = await db.select().from(users).where(inArray(users.id, ownerIds));
  const results = [];
  for (const batch of batches) {
    const claimed = await claimBatch(batch);
    if (!claimed) {
      results.push({ batchId: batch.id, status: "leased" });
      continue;
    }
    const owner = owners.find((candidate) => candidate.id === batch.ownerId);
    if (!owner) {
      const now = new Date();
      await db.update(mediaJobs).set({ status: "failed", errorCode: "BATCH_OWNER_MISSING", errorMessage: "批次所属账号不存在", finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, batch.id));
      results.push({ batchId: batch.id, status: "failed", code: "BATCH_OWNER_MISSING" });
      await releaseBatch(batch.id, claimed.token);
      continue;
    }
    try {
      results.push(await runEpisodeBatchStep(claimed.batch, { id: owner.id, email: owner.email, displayName: owner.displayName }));
    } finally {
      await releaseBatch(batch.id, claimed.token);
    }
  }
  return { active: batches.length, results };
}
