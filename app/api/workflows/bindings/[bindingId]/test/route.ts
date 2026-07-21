import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { workflowBindings, workflowTestRuns } from "../../../../../../db/schema";
import { applyWorkflowInputs, loadWorkflow, queueWorkflow, uploadWorkflowInput } from "../../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../../lib/server/http";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { getWorkflowCapability } from "../../../../../lib/workflow-capabilities";

type RouteContext = { params: Promise<{ bindingId: string }> };

function publicTestRun(run: typeof workflowTestRuns.$inferSelect) {
  return {
    id: run.id,
    status: run.status,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    inputSummary: JSON.parse(run.inputSummaryJson) as Record<string, unknown>,
    result: run.resultJson ? JSON.parse(run.resultJson) as Record<string, unknown> : null,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { bindingId } = await context.params;
  const db = getDb();
  const binding = (await db.select({ id: workflowBindings.id }).from(workflowBindings).where(and(eq(workflowBindings.id, bindingId), eq(workflowBindings.ownerId, user.id))).limit(1))[0];
  if (!binding) return errorResponse(404, "WORKFLOW_NOT_FOUND", "工作流绑定不存在");
  const runs = await db.select().from(workflowTestRuns)
    .where(and(eq(workflowTestRuns.workflowBindingId, bindingId), eq(workflowTestRuns.ownerId, user.id)))
    .orderBy(desc(workflowTestRuns.createdAt))
    .limit(10);
  return json({ runs: runs.map(publicTestRun) });
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { bindingId } = await context.params;
  const db = getDb();
  const binding = (await db.select().from(workflowBindings).where(and(eq(workflowBindings.id, bindingId), eq(workflowBindings.ownerId, user.id), eq(workflowBindings.enabled, true))).limit(1))[0];
  if (!binding) return errorResponse(404, "WORKFLOW_NOT_FOUND", "工作流绑定不存在或尚未启用");
  const capability = getWorkflowCapability(binding.capability);
  if (!capability) return errorResponse(400, "CAPABILITY_NOT_SUPPORTED", "工作流能力无法测试");

  const runId = crypto.randomUUID();
  const now = new Date();
  await db.insert(workflowTestRuns).values({ id: runId, ownerId: user.id, workflowBindingId: binding.id, capability: binding.capability, status: "submitting", createdAt: now, updatedAt: now });
  try {
    const form = await request.formData();
    const payload: Record<string, unknown> = {};
    const summary: Record<string, unknown> = {};
    for (const input of capability.inputs) {
      const value = form.get(input.key);
      if (["image", "video", "audio"].includes(input.valueType)) {
        if (!(value instanceof File) || value.size === 0) {
          if (input.required) throw new Error(`TEST_INPUT_REQUIRED:${input.label}`);
          continue;
        }
        if (value.size > 15 * 1024 * 1024) throw new Error(`${input.label}不能超过 15 MB`);
        if (input.valueType === "image" && !value.type.startsWith("image/")) throw new Error(`${input.label}必须是图片文件`);
        const uploaded = await uploadWorkflowInput(value, `xiaofeixiang-test-${runId}`);
        payload[input.key] = uploaded.workflowValue;
        summary[input.key] = { name: value.name, size: value.size, type: value.type };
        continue;
      }
      if (typeof value !== "string" || !value.trim()) {
        if (input.required) throw new Error(`TEST_INPUT_REQUIRED:${input.label}`);
        continue;
      }
      if (input.valueType === "number") payload[input.key] = Number(value);
      else if (input.valueType === "boolean") payload[input.key] = value === "true" || value === "1";
      else if (input.valueType === "json") payload[input.key] = JSON.parse(value);
      else payload[input.key] = value;
      summary[input.key] = payload[input.key];
    }
    const workflow = await loadWorkflow(binding.workflowStorageKey);
    const contract = JSON.parse(binding.inputContractJson) as Record<string, { nodeId: string; input: string }>;
    const prepared = applyWorkflowInputs(workflow, contract, payload);
    const queued = await queueWorkflow(prepared, { executionType: "test_run", executionId: runId, ownerId: user.id, capability: binding.capability, bindingId: binding.id });
    await db.update(workflowTestRuns).set({ status: "queued", comfyPromptId: queued.promptId, inputSummaryJson: JSON.stringify(summary), updatedAt: new Date() }).where(eq(workflowTestRuns.id, runId));
    return json({ run: { id: runId, status: "queued", promptId: queued.promptId, progressSource: queued.bridgeRegistered ? "bridge" : "polling" } }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKFLOW_TEST_SUBMIT_FAILED";
    await db.update(workflowTestRuns).set({ status: "failed", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(workflowTestRuns.id, runId));
    return errorResponse(502, "WORKFLOW_TEST_SUBMIT_FAILED", "测试任务提交失败", { runId, reason: message });
  }
}
