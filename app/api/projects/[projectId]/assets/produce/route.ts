import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { mediaJobs } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { getVerifiedWorkflowBinding } from "../../../../../lib/server/verified-workflows";
import { buildVisualAssetBatchItems, latestVisualAssetBatches, parseVisualAssetBatchPayload, visualAssetBatchItemGenerated, visualAssetBatchOperation } from "../../../../../lib/server/visual-asset-batch";
import { getWorkflowCapability } from "../../../../../lib/workflow-capabilities";

type RouteContext = { params: Promise<{ projectId: string }> };
type BatchAction = { action?: "start" | "cancel" };

async function responseState(ownerId: string, projectId: string) {
  const items = await buildVisualAssetBatchItems(projectId);
  const generated = await Promise.all(items.map((item) => visualAssetBatchItemGenerated(projectId, item)));
  const records = await latestVisualAssetBatches(ownerId, projectId);
  const active = records.find((job) => ["queued", "running"].includes(job.status)) ?? null;
  const latest = records[0] ?? null;
  const payload = active ? parseVisualAssetBatchPayload(active.payloadJson) : latest ? parseVisualAssetBatchPayload(latest.payloadJson) : null;
  const current = active ? payload?.items[payload.currentIndex] ?? null : null;
  const generatedCount = generated.filter(Boolean).length;
  return {
    status: active ? "running" : latest?.status === "failed" ? "failed" : latest?.status === "cancelled" ? "cancelled" : generatedCount === items.length && items.length ? "complete" : "idle",
    batch: active ? { id: active.id, progress: active.progress, currentIndex: payload?.currentIndex ?? 0, total: payload?.items.length ?? items.length } : null,
    progress: { generated: generatedCount, total: items.length, remaining: Math.max(0, items.length - generatedCount) },
    currentItem: current ? { key: current.key, title: current.title, capability: current.capability } : null,
    lastFailure: latest?.status === "failed" ? { code: latest.errorCode, message: latest.errorMessage, item: payload?.items[payload.currentIndex] ?? null } : null,
  };
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  return json(await responseState(user.id, projectId));
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<BatchAction>(request);
  const action = body?.action ?? "start";
  const records = await latestVisualAssetBatches(user.id, projectId);
  const active = records.find((job) => ["queued", "running"].includes(job.status)) ?? null;

  if (action === "cancel") {
    if (!active) return errorResponse(409, "VISUAL_ASSET_BATCH_NOT_RUNNING", "当前没有正在执行的视觉资产批次");
    const now = new Date();
    await getDb().update(mediaJobs).set({ status: "cancelled", errorCode: "USER_CANCELLED", errorMessage: "用户停止了视觉资产批量生成；已完成结果会继续保留", finishedAt: now, updatedAt: now }).where(eq(mediaJobs.id, active.id));
    return json(await responseState(user.id, projectId));
  }
  if (action !== "start") return errorResponse(400, "INVALID_BATCH_ACTION", "不支持的视觉资产批次操作");
  if (active) return json(await responseState(user.id, projectId), { status: 202 });

  const items = await buildVisualAssetBatchItems(projectId);
  if (!items.length) return errorResponse(409, "VISUAL_ASSETS_REQUIRED", "当前项目还没有可生成的角色形态、场景或道具");
  const generated = await Promise.all(items.map((item) => visualAssetBatchItemGenerated(projectId, item)));
  const firstPendingIndex = generated.findIndex((ready) => !ready);
  if (firstPendingIndex < 0) return json(await responseState(user.id, projectId));
  const capabilities = [...new Set(items.filter((_, index) => !generated[index]).map((item) => item.capability))];
  const bindings = await Promise.all(capabilities.map(async (capability) => ({ capability, binding: await getVerifiedWorkflowBinding(user.id, capability) })));
  const missing = bindings.filter((item) => !item.binding).map((item) => getWorkflowCapability(item.capability)?.name ?? item.capability);
  if (missing.length) return errorResponse(409, "VISUAL_ASSET_WORKFLOWS_REQUIRED", `批量生成前还需配置并测试：${missing.join("、")}`, { missingCapabilities: missing });

  const now = new Date();
  await getDb().insert(mediaJobs).values({
    id: crypto.randomUUID(),
    ownerId: user.id,
    projectId,
    entityType: "project",
    entityId: projectId,
    operation: visualAssetBatchOperation,
    status: "running",
    progress: Math.round(firstPendingIndex / items.length * 100),
    payloadJson: JSON.stringify({ items, currentIndex: firstPendingIndex, attemptedKeys: [] }),
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return json(await responseState(user.id, projectId), { status: 202 });
}
