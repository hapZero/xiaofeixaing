import { and, desc, eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../db";
import { assets, generationJobs, workflowBindings } from "../../../../db/schema";
import { applyWorkflowInputs, comfyUiConfigured, loadWorkflow, queueWorkflow, uploadWorkflowInput } from "../../../lib/server/comfyui";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getOwnedProject } from "../../../lib/server/project-access";
import { getRequestUser } from "../../../lib/server/request-user";
import { isWorkflowCapability, workflowCapabilities } from "../../../lib/workflow-capabilities";

type CreateJobBody = { projectId?: string; entityType?: string; entityId?: string; capability?: string; payload?: Record<string, unknown> };

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
  const body = await readJson<CreateJobBody>(request);
  if (!body?.projectId || !body.entityType || !body.entityId || !body.capability || !isWorkflowCapability(body.capability)) return errorResponse(400, "INVALID_JOB", "生成任务参数不完整");
  if (!await getOwnedProject(body.projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const capability = body.capability;
  const requirement = workflowCapabilities.find((item) => item.key === capability);
  const db = getDb();
  const bindingRows = await db.select().from(workflowBindings).where(and(eq(workflowBindings.ownerId, user.id), eq(workflowBindings.capability, capability), eq(workflowBindings.enabled, true))).limit(1);
  const binding = bindingRows[0];
  if (!binding) return errorResponse(409, "WORKFLOW_REQUIRED", `需要先配置“${requirement?.name ?? capability}”工作流`, requirement);
  if (!comfyUiConfigured()) return errorResponse(503, "COMFYUI_NOT_CONFIGURED", "尚未配置 ComfyUI 服务地址");

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(generationJobs).values({ id, ownerId: user.id, projectId: body.projectId, entityType: body.entityType, entityId: body.entityId, capability, workflowBindingId: binding.id, status: "submitting", payloadJson: JSON.stringify(body.payload ?? {}), createdAt: now, updatedAt: now });
  try {
    const workflow = await loadWorkflow(binding.workflowStorageKey);
    const contract = JSON.parse(binding.inputContractJson) as Record<string, { nodeId: string; input: string }>;
    const payload: Record<string, unknown> = { ...(body.payload ?? {}) };
    if (capability === "image_to_video" && typeof payload.firstFrameAssetId === "string") {
      const asset = (await db.select().from(assets).where(and(eq(assets.id, payload.firstFrameAssetId), eq(assets.projectId, body.projectId))).limit(1))[0];
      if (!asset?.storageKey) throw new Error("FIRST_FRAME_ASSET_NOT_FOUND");
      const object = await getMediaBucket().get(asset.storageKey);
      if (!object) throw new Error("FIRST_FRAME_FILE_NOT_FOUND");
      const file = new File([await object.arrayBuffer()], asset.name || "first-frame.png", { type: object.httpMetadata?.contentType ?? "image/png" });
      const uploaded = await uploadWorkflowInput(file, `xiaofeixiang-shot-${body.entityId}`);
      payload.firstFrame = uploaded.workflowValue;
    }
    const prepared = applyWorkflowInputs(workflow, contract, payload);
    const queued = await queueWorkflow(prepared, { executionType: "generation_job", executionId: id, ownerId: user.id, projectId: body.projectId, capability, bindingId: binding.id });
    await db.update(generationJobs).set({ status: "queued", comfyPromptId: queued.promptId, startedAt: new Date(), updatedAt: new Date() }).where(eq(generationJobs.id, id));
    return json({ job: { id, status: "queued", promptId: queued.promptId, progressSource: queued.bridgeRegistered ? "bridge" : "polling" } }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_GENERATION_ERROR";
    await db.update(generationJobs).set({ status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(generationJobs.id, id));
    return errorResponse(502, "GENERATION_SUBMIT_FAILED", "任务未能提交到 ComfyUI", { jobId: id, reason: message });
  }
}
