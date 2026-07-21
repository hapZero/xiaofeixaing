import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { characters } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; characterId: string }> };
type UpdateCharacterBody = Partial<{ canonicalName: string; voiceDescription: string; voiceLocked: boolean }>;

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, characterId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdateCharacterBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const existing = await getDb().select().from(characters).where(and(eq(characters.id, characterId), eq(characters.projectId, projectId))).limit(1);
  if (!existing[0]) return errorResponse(404, "CHARACTER_NOT_FOUND", "角色不存在或无权访问");
  const update: UpdateCharacterBody & { updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.canonicalName === "string" && body.canonicalName.trim()) update.canonicalName = body.canonicalName.trim().slice(0, 80);
  if (typeof body.voiceDescription === "string") update.voiceDescription = body.voiceDescription.trim().slice(0, 2_000);
  if (typeof body.voiceLocked === "boolean") update.voiceLocked = body.voiceLocked;
  await getDb().update(characters).set(update).where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)));
  const saved = await getDb().select().from(characters).where(eq(characters.id, characterId)).limit(1);
  return json({ character: saved[0] });
}
