import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { assets, characters, episodes, projects, shots } from "../../../../db/schema";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getOwnedProject } from "../../../lib/server/project-access";
import { getRequestUser } from "../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };
type UpdateProjectBody = Partial<{ title: string; status: string; stylePreset: string; aspectRatio: string; synopsis: string }>;

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const projectEpisodes = await db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber);
  const projectAssets = await db.select().from(assets).where(eq(assets.projectId, projectId));
  const projectCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  const episodeShots = projectEpisodes.length
    ? (await Promise.all(projectEpisodes.map((episode) => db.select().from(shots).where(eq(shots.episodeId, episode.id)).orderBy(shots.sequence)))).flat()
    : [];
  return json({ project, episodes: projectEpisodes, assets: projectAssets, characters: projectCharacters, shots: episodeShots });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdateProjectBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const update: UpdateProjectBody & { updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim().slice(0, 80);
  if (typeof body.status === "string") update.status = body.status;
  if (typeof body.stylePreset === "string") update.stylePreset = body.stylePreset.trim();
  if (typeof body.aspectRatio === "string") update.aspectRatio = body.aspectRatio.trim();
  if (typeof body.synopsis === "string") update.synopsis = body.synopsis.trim();
  await getDb().update(projects).set(update).where(eq(projects.id, projectId));
  const project = await getOwnedProject(projectId, user.id);
  return json({ project });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) {
    return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  }
  await getDb().delete(projects).where(eq(projects.id, projectId));
  return new Response(null, { status: 204 });
}
