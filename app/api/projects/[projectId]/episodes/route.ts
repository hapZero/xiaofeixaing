import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { episodes, projects } from "../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };
type CreateEpisodeBody = Partial<{ title: string }>;

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  if (project.sourceType === "canvas") return errorResponse(409, "SCRIPT_PROJECT_REQUIRED", "自由画布项目尚未建立剧本结构");

  const body = await readJson<CreateEpisodeBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");
  const current = await getDb().select({ episodeNumber: episodes.episodeNumber }).from(episodes).where(eq(episodes.projectId, projectId));
  const episodeNumber = Math.max(0, ...current.map((episode) => episode.episodeNumber)) + 1;
  if (episodeNumber > 100) return errorResponse(409, "EPISODE_LIMIT_REACHED", "单个短剧最多创建 100 集");

  const now = new Date();
  const episode = {
    id: crypto.randomUUID(),
    projectId,
    episodeNumber,
    title: body.title?.trim().slice(0, 120) || `第 ${episodeNumber} 集`,
    summary: null,
    scriptText: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(episodes).values(episode);
  await getDb().update(projects).set({ status: "scripting", updatedAt: now }).where(eq(projects.id, projectId));
  return json({ episode }, { status: 201 });
}
