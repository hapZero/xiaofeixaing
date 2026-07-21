import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { generationJobs } from "../../../../../db/schema";
import { getWorkflowHistory } from "../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../lib/server/http";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { jobId } = await context.params;
  const db = getDb();
  const rows = await db.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.ownerId, user.id))).limit(1);
  const job = rows[0];
  if (!job) return errorResponse(404, "JOB_NOT_FOUND", "生成任务不存在");
  if (!job.comfyPromptId || !["queued", "running"].includes(job.status)) return json({ job });

  try {
    const history = await getWorkflowHistory(job.comfyPromptId);
    const record = (history as Record<string, unknown>)[job.comfyPromptId];
    if (!record) return json({ job: { ...job, status: "running" } });
    const completed = { status: "succeeded", resultJson: JSON.stringify(record), finishedAt: new Date(), updatedAt: new Date() };
    await db.update(generationJobs).set(completed).where(eq(generationJobs.id, jobId));
    return json({ job: { ...job, ...completed, result: record } });
  } catch (error) {
    return json({ job, pollingWarning: error instanceof Error ? error.message : "HISTORY_UNAVAILABLE" });
  }
}
