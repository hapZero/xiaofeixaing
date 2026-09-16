import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { episodes, generationJobs, projects, storyBibles } from "../../../../../db/schema";
import { isStoryOutlineReady } from "../../../../lib/drama-outline";
import { executeDramaScriptGeneration } from "../../../../lib/server/drama-script-generation";
import { errorResponse, json } from "../../../../lib/server/http";
import { getLlmConnection } from "../../../../lib/server/llm";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };

function requestedEpisodeCount(payloadJson: string, fallback = 3): number {
  try {
    const value = Number((JSON.parse(payloadJson) as { episodeCount?: unknown }).episodeCount);
    if (Number.isFinite(value)) return Math.min(100, Math.max(1, Math.round(value)));
  } catch {
    // Fall back to the project's saved episode plan.
  }
  return fallback;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  if (project.sourceType !== "ai_script") return errorResponse(409, "AI_SCRIPT_PROJECT_REQUIRED", "只有从创意生成的短剧可以重新生成全剧");
  if (!project.synopsis?.trim()) return errorResponse(409, "IDEA_REQUIRED", "当前项目没有保存原始创意，无法重新生成全剧");

  let mode: "full" | "episodes_only" | "outline_only" = "full";
  try {
    const body = await request.json() as { mode?: unknown };
    if (body.mode === "episodes_only" || body.mode === "outline_only") mode = body.mode;
  } catch {
    mode = "full";
  }

  const db = getDb();
  const activeJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.capability, "llm_script"),
    inArray(generationJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeJob) return json({ job: activeJob, reused: true }, { status: 202 });

  const connection = await getLlmConnection(user.id).catch(() => null);
  if (!connection) return errorResponse(409, "LLM_REQUIRED", "请先在设置中保存并真实测试文本智能服务");

  const existingStoryBible = (await db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0] ?? null;
  const projectEpisodes = await db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber);
  const latestScriptJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.capability, "llm_script"),
  )).orderBy(desc(generationJobs.createdAt)).limit(1))[0] ?? null;

  let episodeCount = Math.max(projectEpisodes.length, latestScriptJob ? requestedEpisodeCount(latestScriptJob.payloadJson, projectEpisodes.length || 1) : projectEpisodes.length || 1, 1);

  if (mode === "episodes_only") {
    if (!isStoryOutlineReady(existingStoryBible)) {
      return errorResponse(409, "OUTLINE_REQUIRED", "请先完成剧本摘要与人物小传，再重新生成分集正文");
    }
  } else if (mode === "outline_only") {
    if (!project.synopsis?.trim()) return errorResponse(409, "IDEA_REQUIRED", "请先保存原始创意，再生成剧本摘要");
  } else {
    const failedJob = latestScriptJob?.status === "failed" ? latestScriptJob : null;
    if (!failedJob) return errorResponse(409, "SCRIPT_RETRY_NOT_REQUIRED", "当前项目没有需要恢复的全剧生成任务");
    episodeCount = requestedEpisodeCount(failedJob.payloadJson, episodeCount);
  }

  const startedAt = new Date();
  const jobId = crypto.randomUUID();
  const payloadJson = JSON.stringify({
    idea: project.synopsis,
    episodeCount,
    stylePreset: project.stylePreset,
    aspectRatio: project.aspectRatio,
    mode,
    retryOf: latestScriptJob?.status === "failed" ? latestScriptJob.id : null,
  });
  await db.insert(generationJobs).values({
    id: jobId,
    ownerId: user.id,
    projectId,
    entityType: "project",
    entityId: projectId,
    capability: "llm_script",
    workflowBindingId: null,
    status: "running",
    payloadJson,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  await db.update(projects).set({ status: "script_generating", updatedAt: startedAt }).where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)));
  waitUntil(executeDramaScriptGeneration({
    ownerId: user.id,
    jobId,
    project,
    episodeCount,
    connection,
    phase: mode,
    existingStoryBible: mode === "episodes_only" ? existingStoryBible : null,
  }));
  return json({ job: { id: jobId, projectId, entityType: "project", entityId: projectId, capability: "llm_script", status: "running", resultJson: null, errorCode: null, errorMessage: null, createdAt: startedAt, updatedAt: startedAt } }, { status: 202 });
}
