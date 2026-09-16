import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { generationJobs, projects } from "../../../../../db/schema";
import { errorResponse, json } from "../../../../lib/server/http";
import { getLlmConnection } from "../../../../lib/server/llm";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { executeUploadedScriptStructuring } from "../../../../lib/server/uploaded-script-structuring";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  if (project.sourceType !== "upload") return errorResponse(409, "UPLOADED_SCRIPT_REQUIRED", "只有上传的完整剧本需要重新整理分集");
  if (!project.sourceText?.trim()) return errorResponse(409, "SCRIPT_REQUIRED", "当前项目没有保存原始完整剧本");
  const db = getDb();
  const activeJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.capability, "llm_structure"),
    inArray(generationJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeJob) return json({ job: activeJob, reused: true }, { status: 202 });
  const failedJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.capability, "llm_structure"),
    eq(generationJobs.status, "failed"),
  )).orderBy(desc(generationJobs.createdAt)).limit(1))[0];
  if (!failedJob) return errorResponse(409, "STRUCTURE_RETRY_NOT_REQUIRED", "当前项目没有需要恢复的分集整理任务");
  const connection = await getLlmConnection(user.id).catch(() => null);
  if (!connection) return errorResponse(409, "LLM_REQUIRED", "请先在设置中保存并真实测试文本智能服务");

  const startedAt = new Date();
  const jobId = crypto.randomUUID();
  await db.insert(generationJobs).values({
    id: jobId,
    ownerId: user.id,
    projectId,
    entityType: "project",
    entityId: projectId,
    capability: "llm_structure",
    workflowBindingId: null,
    status: "running",
    payloadJson: JSON.stringify({ sourceLength: project.sourceText.length, stylePreset: project.stylePreset, aspectRatio: project.aspectRatio, retryOf: failedJob.id }),
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  await db.update(projects).set({ status: "script_structuring", updatedAt: startedAt }).where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)));
  waitUntil(executeUploadedScriptStructuring({ ownerId: user.id, jobId, project, connection }));
  return json({ job: { id: jobId, projectId, entityType: "project", entityId: projectId, capability: "llm_structure", status: "running", resultJson: null, errorCode: null, errorMessage: null, createdAt: startedAt, updatedAt: startedAt } }, { status: 202 });
}
