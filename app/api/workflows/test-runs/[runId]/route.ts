import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { workflowBindings, workflowTestRuns } from "../../../../../db/schema";
import { downloadWorkflowOutput, getHistoryRecord, getWorkflowHistory, historyFailed, inspectMp4DurationSeconds, selectWorkflowInlineOutput, selectWorkflowOutput, type WorkflowOutputContract } from "../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../lib/server/http";
import { getRequestUser } from "../../../../lib/server/request-user";
import { syncExecutionProgress } from "../../../../lib/server/workflow-progress";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { runId } = await context.params;
  const db = getDb();
  const run = (await db.select().from(workflowTestRuns).where(and(eq(workflowTestRuns.id, runId), eq(workflowTestRuns.ownerId, user.id))).limit(1))[0];
  if (!run) return errorResponse(404, "TEST_RUN_NOT_FOUND", "测试任务不存在");
  if (!["queued", "running"].includes(run.status) || !run.comfyPromptId) return json({ run: { ...run, result: run.resultJson ? JSON.parse(run.resultJson) : null } });
  try {
    const live = await syncExecutionProgress({ ownerId: user.id, executionType: "test_run", executionId: runId, promptId: run.comfyPromptId });
    if (live?.snapshot.status === "failed") throw new Error("COMFYUI_EXECUTION_FAILED");
    const history = await getWorkflowHistory(run.comfyPromptId);
    const record = getHistoryRecord(history, run.comfyPromptId);
    if (!record) {
      if (run.status !== "running") await db.update(workflowTestRuns).set({ status: "running", updatedAt: new Date() }).where(eq(workflowTestRuns.id, runId));
      return json({ run: { ...run, status: "running", progress: live?.progress ?? null } });
    }
    if (historyFailed(record)) throw new Error("COMFYUI_EXECUTION_FAILED");
    const binding = (await db.select().from(workflowBindings).where(and(eq(workflowBindings.id, run.workflowBindingId), eq(workflowBindings.ownerId, user.id))).limit(1))[0];
    if (!binding) throw new Error("WORKFLOW_BINDING_MISSING");
    const contract = JSON.parse(binding.outputContractJson) as WorkflowOutputContract;
    const file = selectWorkflowOutput(record, contract);
    if (!file && contract.mediaType === "json") {
      const value = selectWorkflowInlineOutput(record, contract);
      if (value === undefined) throw new Error(`WORKFLOW_OUTPUT_MISSING:${contract.nodeId}.${contract.output}`);
      const result = { mediaType: contract.mediaType, value, outputUrl: `/api/workflows/test-runs/${runId}/output`, durationSeconds: null };
      const completed = { status: "succeeded", resultJson: JSON.stringify(result), finishedAt: new Date(), updatedAt: new Date() };
      await db.update(workflowTestRuns).set(completed).where(eq(workflowTestRuns.id, runId));
      return json({ run: { ...run, ...completed, result, progress: { ...(live?.progress ?? {}), overall: 100, stage: "结果已返回" } } });
    }
    if (!file) throw new Error(`WORKFLOW_OUTPUT_MISSING:${contract.nodeId}.${contract.output}`);
    if (file.outputKey && file.outputKey !== contract.output) {
      await db.update(workflowBindings).set({ outputContractJson: JSON.stringify({ ...contract, output: file.outputKey }), updatedAt: new Date() }).where(eq(workflowBindings.id, binding.id));
    }
    let durationSeconds: number | null = null;
    if (contract.mediaType === "video") {
      const output = await downloadWorkflowOutput(file);
      durationSeconds = inspectMp4DurationSeconds(output.bytes);
      const inputSummary = JSON.parse(run.inputSummaryJson) as { duration?: unknown };
      const requestedDuration = Number(inputSummary.duration);
      if (durationSeconds !== null && requestedDuration > 0 && durationSeconds < requestedDuration * 0.5) {
        throw new Error(`WORKFLOW_VIDEO_TOO_SHORT:${durationSeconds.toFixed(2)}s/${requestedDuration}s`);
      }
    }
    const result = { mediaType: contract.mediaType, file, outputUrl: `/api/workflows/test-runs/${runId}/output`, durationSeconds };
    const completed = { status: "succeeded", resultJson: JSON.stringify(result), finishedAt: new Date(), updatedAt: new Date() };
    await db.update(workflowTestRuns).set(completed).where(eq(workflowTestRuns.id, runId));
    return json({ run: { ...run, ...completed, result, progress: { ...(live?.progress ?? {}), overall: 100, stage: "结果已返回" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKFLOW_TEST_FAILED";
    const failed = { status: "failed", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() };
    await db.update(workflowTestRuns).set(failed).where(eq(workflowTestRuns.id, runId));
    return json({ run: { ...run, ...failed } });
  }
}
