import { waitUntil } from "cloudflare:workers";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { episodes, generationJobs, projects, storyBibles } from "../../../../../../../db/schema";
import { isStoryOutlineReady, parseDramaOutlineFromStoryBible } from "../../../../../../lib/drama-outline";
import { episodeOutlinePromptFromStoryBible } from "../../../../../../lib/server/drama-script-generation";
import { errorResponse, json } from "../../../../../../lib/server/http";
import { generateEpisodeScript, getLlmConnection } from "../../../../../../lib/server/llm";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const episode = (await getDb().select().from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId))).limit(1))[0];
  if (!episode) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");
  const connection = await getLlmConnection(user.id).catch(() => null);
  if (!connection) return errorResponse(409, "LLM_REQUIRED", "请先在设置中保存并真实测试文本智能服务");
  const storyBible = (await getDb().select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1))[0] ?? null;
  if (project.sourceType === "ai_script" && !isStoryOutlineReady(storyBible)) {
    return errorResponse(409, "OUTLINE_REQUIRED", "请先完成剧本摘要与人物小传，再生成或重写分集正文");
  }
  const precedingEpisodes = await getDb().select().from(episodes).where(and(
    eq(episodes.projectId, projectId),
    lt(episodes.episodeNumber, episode.episodeNumber),
  )).orderBy(episodes.episodeNumber);
  const db = getDb();
  const activeJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.entityType, "episode"),
    eq(generationJobs.entityId, episode.id),
    eq(generationJobs.capability, "llm_episode"),
    inArray(generationJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeJob) return json({ job: activeJob, reused: true }, { status: 202 });

  const jobId = crypto.randomUUID();
  const startedAt = new Date();
  await db.insert(generationJobs).values({
    id: jobId,
    ownerId: user.id,
    projectId,
    entityType: "episode",
    entityId: episode.id,
    capability: "llm_episode",
    workflowBindingId: null,
    status: "running",
    payloadJson: JSON.stringify({ episodeNumber: episode.episodeNumber, rewrite: Boolean(episode.scriptText) }),
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  await db.update(episodes).set({ status: "generating", updatedAt: startedAt }).where(eq(episodes.id, episode.id));
  await db.update(projects).set({ status: "script_generating", updatedAt: startedAt }).where(eq(projects.id, project.id));

  waitUntil((async () => {
    try {
      const parsedOutline = parseDramaOutlineFromStoryBible(storyBible);
      const generated = await generateEpisodeScript(connection, {
        projectTitle: project.title,
        synopsis: project.synopsis || "",
        storyOutline: episodeOutlinePromptFromStoryBible(storyBible),
        allowedCharacterNames: parsedOutline.characters.map((character) => character.name),
        episodeNumber: episode.episodeNumber,
        stylePreset: project.stylePreset,
        aspectRatio: project.aspectRatio,
        precedingEpisodes,
        existingEpisode: episode,
      });
      const completedAt = new Date();
      await db.update(episodes).set({ ...generated, status: "generated", updatedAt: completedAt }).where(eq(episodes.id, episode.id));
      await db.update(projects).set({ status: "scripting", updatedAt: completedAt }).where(eq(projects.id, project.id));
      await db.update(generationJobs).set({ status: "succeeded", resultJson: JSON.stringify({ episodeId: episode.id, episodeNumber: episode.episodeNumber }), finishedAt: completedAt, updatedAt: completedAt }).where(eq(generationJobs.id, jobId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "LLM_EPISODE_FAILED";
      const failedAt = new Date();
      await db.update(episodes).set({ status: episode.scriptText ? "editing" : "draft", updatedAt: failedAt }).where(eq(episodes.id, episode.id));
      await db.update(projects).set({ status: "script_generation_failed", updatedAt: failedAt }).where(eq(projects.id, project.id));
      await db.update(generationJobs).set({ status: "failed", errorCode: "LLM_EPISODE_FAILED", errorMessage: reason, finishedAt: failedAt, updatedAt: failedAt }).where(eq(generationJobs.id, jobId));
    }
  })());
  return json({ job: { id: jobId, projectId, entityType: "episode", entityId: episode.id, capability: "llm_episode", status: "running" } }, { status: 202 });
}
