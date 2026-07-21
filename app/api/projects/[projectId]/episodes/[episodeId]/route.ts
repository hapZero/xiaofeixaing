import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { episodes, projects } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; episodeId: string }> };
type UpdateEpisodeBody = Partial<{
  title: string;
  summary: string;
  scriptText: string;
  status: string;
}>;

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, episodeId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) {
    return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  }

  const body = await readJson<UpdateEpisodeBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");
  const update: UpdateEpisodeBody & { updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim().slice(0, 120);
  if (typeof body.summary === "string") update.summary = body.summary.trim().slice(0, 10_000);
  if (typeof body.scriptText === "string") update.scriptText = body.scriptText.slice(0, 100_000);
  if (typeof body.status === "string") update.status = body.status.slice(0, 32);

  const existing = await getDb()
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(projects, eq(projects.id, episodes.projectId))
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId), eq(projects.ownerId, user.id)))
    .limit(1);
  if (!existing[0]) return errorResponse(404, "EPISODE_NOT_FOUND", "分集不存在或无权访问");

  await getDb().update(episodes).set(update).where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  const saved = await getDb().select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  return json({ episode: saved[0] });
}
