import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { generationJobs, mediaJobs, users } from "../../../db/schema";
import { GET as syncGenerationJobRoute } from "../../api/generation/jobs/[jobId]/route";
import { GenerationSubmissionError, submitGenerationJobForUser } from "./generation-submit";
import { parseVisualAssetBatchPayload, visualAssetBatchItemGenerated, visualAssetBatchJobPayload, visualAssetBatchOperation } from "./visual-asset-batch";

type RunnerUser = { id: string; email: string; displayName: string };
type ActiveBatch = typeof mediaJobs.$inferSelect;

function internalRequest(user: RunnerUser, path: string) {
  return new Request(`https://internal.xiaofeixiang.local${path}`, { headers: {
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.displayName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  } });
}

async function claimBatch(batch: ActiveBatch) {
  const current = parseVisualAssetBatchPayload(batch.payloadJson);
  if (Number(current.runnerLeaseExpiresAt) > Date.now()) return null;
  const token = crypto.randomUUID();
  const payloadJson = JSON.stringify({ ...current, runnerLeaseToken: token, runnerLeaseExpiresAt: Date.now() + 30_000 });
  await getDb().update(mediaJobs).set({ payloadJson, updatedAt: new Date() }).where(and(
    eq(mediaJobs.id, batch.id),
    eq(mediaJobs.payloadJson, batch.payloadJson),
    inArray(mediaJobs.status, ["queued", "running"]),
  ));
  const claimed = (await getDb().select().from(mediaJobs).where(eq(mediaJobs.id, batch.id)).limit(1))[0] ?? null;
  return claimed && parseVisualAssetBatchPayload(claimed.payloadJson).runnerLeaseToken === token ? { batch: claimed, token } : null;
}

async function releaseBatch(batchId: string, token: string) {
  const current = (await getDb().select().from(mediaJobs).where(eq(mediaJobs.id, batchId)).limit(1))[0] ?? null;
  if (!current) return;
  const payload = parseVisualAssetBatchPayload(current.payloadJson);
  if (payload.runnerLeaseToken !== token) return;
  delete payload.runnerLeaseToken;
  delete payload.runnerLeaseExpiresAt;
  await getDb().update(mediaJobs).set({ payloadJson: JSON.stringify(payload), updatedAt: new Date() }).where(and(eq(mediaJobs.id, batchId), eq(mediaJobs.payloadJson, current.payloadJson)));
}

async function failBatch(batch: ActiveBatch, itemTitle: string, code: string, message: string) {
  const now = new Date();
  await getDb().update(mediaJobs).set({ status: "failed", errorCode: code.slice(0, 80), errorMessage: `${itemTitle}：${message}`.slice(0, 1_000), finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, batch.id));
  return { batchId: batch.id, status: "failed", code, message };
}

async function advanceBatch(batch: ActiveBatch) {
  const payload = parseVisualAssetBatchPayload(batch.payloadJson);
  let nextIndex = payload.currentIndex;
  while (nextIndex < payload.items.length && await visualAssetBatchItemGenerated(batch.projectId, payload.items[nextIndex])) nextIndex += 1;
  const now = new Date();
  if (nextIndex >= payload.items.length) {
    await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify({ generatedKeys: payload.items.map((item) => item.key) }), finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, batch.id));
    return { batchId: batch.id, status: "complete" };
  }
  await getDb().update(mediaJobs).set({ progress: Math.round(nextIndex / Math.max(1, payload.items.length) * 100), payloadJson: JSON.stringify({ ...payload, currentIndex: nextIndex }), updatedAt: now }).where(eq(mediaJobs.id, batch.id));
  return { batchId: batch.id, status: nextIndex === payload.currentIndex ? "pending" : "advanced", item: payload.items[nextIndex].title };
}

async function syncJob(user: RunnerUser, jobId: string) {
  const response = await syncGenerationJobRoute(internalRequest(user, `/api/generation/jobs/${jobId}`), { params: Promise.resolve({ jobId }) });
  return await response.json() as { job?: { status: string; errorCode?: string | null; errorMessage?: string | null } };
}

export async function runVisualAssetBatchStep(batch: ActiveBatch, user: RunnerUser) {
  const payload = parseVisualAssetBatchPayload(batch.payloadJson);
  const item = payload.items[payload.currentIndex] ?? null;
  if (!item) return advanceBatch(batch);
  if (await visualAssetBatchItemGenerated(batch.projectId, item)) return advanceBatch(batch);

  const db = getDb();
  const activeJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, batch.ownerId),
    eq(generationJobs.projectId, batch.projectId),
    eq(generationJobs.entityType, item.entityType),
    eq(generationJobs.entityId, item.entityId),
    eq(generationJobs.capability, item.capability),
    inArray(generationJobs.status, ["submitting", "queued", "running"]),
  )).orderBy(desc(generationJobs.createdAt)).limit(1))[0] ?? null;
  if (activeJob) {
    const synced = (await syncJob(user, activeJob.id)).job;
    if (synced?.status === "failed") return failBatch(batch, item.title, synced.errorCode ?? "VISUAL_ASSET_GENERATION_FAILED", synced.errorMessage ?? "视觉资产生成失败");
    if (synced?.status === "succeeded") return advanceBatch(batch);
    await db.update(mediaJobs).set({ updatedAt: new Date() }).where(eq(mediaJobs.id, batch.id));
    return { batchId: batch.id, status: "waiting_generation", item: item.title, jobId: activeJob.id };
  }

  if (payload.attemptedKeys.includes(item.key)) {
    const latest = (await db.select().from(generationJobs).where(and(
      eq(generationJobs.ownerId, batch.ownerId),
      eq(generationJobs.projectId, batch.projectId),
      eq(generationJobs.entityType, item.entityType),
      eq(generationJobs.entityId, item.entityId),
      eq(generationJobs.capability, item.capability),
    )).orderBy(desc(generationJobs.createdAt)).limit(1))[0] ?? null;
    return failBatch(batch, item.title, latest?.errorCode ?? "VISUAL_ASSET_RESULT_MISSING", latest?.errorMessage ?? "任务结束后没有取得可用图片");
  }

  try {
    const attemptedKeys = [...payload.attemptedKeys, item.key];
    await db.update(mediaJobs).set({ payloadJson: JSON.stringify({ ...payload, attemptedKeys }), updatedAt: new Date() }).where(eq(mediaJobs.id, batch.id));
    const job = await submitGenerationJobForUser(batch.ownerId, {
      projectId: batch.projectId,
      entityType: item.entityType,
      entityId: item.entityId,
      capability: item.capability,
      payload: await visualAssetBatchJobPayload(batch.projectId, item),
    });
    return { batchId: batch.id, status: "submitted", item: item.title, jobId: job.id };
  } catch (error) {
    const code = error instanceof GenerationSubmissionError ? error.code : "VISUAL_ASSET_SUBMIT_FAILED";
    const message = error instanceof Error ? error.message : "视觉资产任务提交失败";
    return failBatch(batch, item.title, code, message);
  }
}

export async function runActiveVisualAssetBatches(limit = 4) {
  const db = getDb();
  const batches = await db.select().from(mediaJobs).where(and(eq(mediaJobs.operation, visualAssetBatchOperation), inArray(mediaJobs.status, ["queued", "running"]))).limit(Math.max(1, Math.min(16, limit)));
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
      results.push(await failBatch(batch, "视觉资产批次", "BATCH_OWNER_MISSING", "批次所属账号不存在"));
      await releaseBatch(batch.id, claimed.token);
      continue;
    }
    try {
      results.push(await runVisualAssetBatchStep(claimed.batch, { id: owner.id, email: owner.email, displayName: owner.displayName }));
    } finally {
      await releaseBatch(batch.id, claimed.token);
    }
  }
  return { active: batches.length, results };
}
