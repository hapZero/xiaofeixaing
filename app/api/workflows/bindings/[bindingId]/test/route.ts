import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { workflowBindings, workflowTestRuns } from "../../../../../../db/schema";
import { prepareLtxWorkflowExecution, isLtxAudioVideoWorkflow } from "../../../../../lib/ltx-video-prompt";
import { applyWorkflowInputs, assertWorkflowInputsApplied, ensureOptionalReferenceImage, loadWorkflow, queueWorkflow, scrubMappedMediaPlaceholders, uploadWorkflowInput } from "../../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../../lib/server/http";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { getWorkflowCapability, isWorkflowCapability } from "../../../../../lib/workflow-capabilities";

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

async function uploadMediaInput(file: File, runId: string, label: string, expectedPrefix: string) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${label}不能超过 15 MB`);
  if (!file.type.startsWith(expectedPrefix)) throw new Error(`${label}文件类型不正确`);
  return uploadWorkflowInput(file, `xiaofeixiang-test-${runId}`);
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

  const runId = crypto.randomUUID();
  const now = new Date();
  await db.insert(workflowTestRuns).values({ id: runId, ownerId: user.id, workflowBindingId: binding.id, capability: binding.capability, status: "submitting", createdAt: now, updatedAt: now });
  try {
    const form = await request.formData();
    const requestedCapability = form.get("_capability");
    const capabilityKey = typeof requestedCapability === "string" && isWorkflowCapability(requestedCapability)
      ? requestedCapability
      : binding.capability;
    const capability = getWorkflowCapability(capabilityKey);
    if (!capability) return errorResponse(400, "CAPABILITY_NOT_SUPPORTED", "工作流能力无法测试");

    const payload: Record<string, unknown> = {};
    const summary: Record<string, unknown> = {};
    for (const input of capability.inputs) {
      if (input.valueType === "imageList") {
        const files = form.getAll(input.key).filter((value): value is File => value instanceof File && value.size > 0);
        if (!files.length) {
          if (input.required) throw new Error(`TEST_INPUT_REQUIRED:${input.label}`);
          continue;
        }
        const uploaded = await Promise.all(files.map(async (file) => {
          const result = await uploadMediaInput(file, runId, input.label, "image/");
          return result.workflowValue;
        }));
        payload[input.key] = uploaded;
        summary[input.key] = files.map((file) => ({ name: file.name, size: file.size, type: file.type }));
        continue;
      }

      const value = form.get(input.key);
      if (["image", "video", "audio"].includes(input.valueType)) {
        if (!(value instanceof File) || value.size === 0) {
          if (input.required) throw new Error(`TEST_INPUT_REQUIRED:${input.label}`);
          continue;
        }
        const expectedPrefix = input.valueType === "image" ? "image/" : input.valueType === "video" ? "video/" : "audio/";
        const uploaded = await uploadMediaInput(value, runId, input.label, expectedPrefix);
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
    const contract = JSON.parse(binding.inputContractJson) as Record<string, { nodeId: string; input: string }>;
    for (const input of capability.inputs) {
      if (input.required && ["image", "video", "audio"].includes(input.valueType) && !contract[input.key]) {
        throw new Error(`WORKFLOW_INPUT_NOT_MAPPED:${input.label}`);
      }
    }
    if (capability.inputs.some((input) => input.key === "prompt" && input.required) && !contract.prompt) {
      throw new Error("WORKFLOW_INPUT_NOT_MAPPED:动作描述");
    }
    await ensureOptionalReferenceImage(payload, contract, uploadWorkflowInput, `xiaofeixiang-test-${runId}`);
    let workflow = scrubMappedMediaPlaceholders(
      await loadWorkflow(binding.workflowStorageKey),
      contract,
      payload,
    );
    const { workflow: ltxWorkflow, payload: executionPayload } = prepareLtxWorkflowExecution(workflow, payload, capabilityKey);
    workflow = ltxWorkflow;
    if (isLtxAudioVideoWorkflow(workflow) && typeof executionPayload.prompt === "string" && !(typeof payload.prompt === "string" && payload.prompt.trim())) {
      summary.prompt = { applied: executionPayload.prompt.slice(0, 120), note: "未填写动作描述，已自动补口型约束" };
    }
    if (executionPayload.promptEnhance === false && payload.promptEnhance === true) {
      summary.promptEnhance = { requested: true, applied: false, reason: "LTX 动作提示增强会换角色/换场景，已自动关闭并由系统补全动作约束" };
    }
    const prepared = applyWorkflowInputs(workflow, contract, executionPayload);
    assertWorkflowInputsApplied(prepared, contract, executionPayload);
    const queued = await queueWorkflow(prepared, { executionType: "test_run", executionId: runId, ownerId: user.id, capability: capabilityKey, bindingId: binding.id });
    await db.update(workflowTestRuns).set({ status: "queued", comfyPromptId: queued.promptId, inputSummaryJson: JSON.stringify(summary), updatedAt: new Date() }).where(eq(workflowTestRuns.id, runId));
    return json({ run: { id: runId, status: "queued", promptId: queued.promptId, progressSource: queued.bridgeRegistered ? "bridge" : "polling" } }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKFLOW_TEST_SUBMIT_FAILED";
    await db.update(workflowTestRuns).set({ status: "failed", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(workflowTestRuns.id, runId));
    return errorResponse(502, "WORKFLOW_TEST_SUBMIT_FAILED", "测试任务提交失败", { runId, reason: message });
  }
}
