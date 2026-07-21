import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { workflowTestRuns } from "../../../../../../db/schema";
import { downloadWorkflowOutput, type ComfyOutputFile } from "../../../../../lib/server/comfyui";
import { errorResponse } from "../../../../../lib/server/http";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { runId } = await context.params;
  const run = (await getDb().select().from(workflowTestRuns).where(and(eq(workflowTestRuns.id, runId), eq(workflowTestRuns.ownerId, user.id))).limit(1))[0];
  if (!run || run.status !== "succeeded" || !run.resultJson) return errorResponse(404, "TEST_OUTPUT_NOT_FOUND", "测试结果尚未生成");
  const result = JSON.parse(run.resultJson) as { file?: ComfyOutputFile; value?: unknown; mediaType?: string };
  if (result.mediaType === "json" && result.value !== undefined) {
    return new Response(JSON.stringify(result.value, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
  }
  if (!result.file) return errorResponse(404, "TEST_OUTPUT_NOT_FOUND", "测试结果文件不存在");
  const output = await downloadWorkflowOutput(result.file);
  return new Response(output.bytes, { headers: { "content-type": output.contentType, "cache-control": "private, no-store" } });
}
