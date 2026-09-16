import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { episodes, segments } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type UpdateSegmentBody = { directorPrompt?: string | null };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");

  const { projectId, segmentId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) {
    return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  }

  const body = await readJson<UpdateSegmentBody>(request);
  if (!body || !("directorPrompt" in body)) {
    return errorResponse(400, "INVALID_BODY", "请提交片段导演指令");
  }

  const existing = await getDb()
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(episodes, eq(episodes.id, segments.episodeId))
    .where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId)))
    .limit(1);
  if (!existing[0]) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");

  const directorPrompt = typeof body.directorPrompt === "string"
    ? body.directorPrompt.trim().slice(0, 30_000) || null
    : null;
  const updatedAt = new Date();
  await getDb().update(segments).set({ directorPrompt, updatedAt }).where(eq(segments.id, segmentId));
  const saved = await getDb().select().from(segments).where(eq(segments.id, segmentId)).limit(1);

  return json({
    segment: saved[0],
    promptSource: directorPrompt ? "manual" : "automatic",
  });
}
