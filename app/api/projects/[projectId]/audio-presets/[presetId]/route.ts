import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { audioPresets } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { invalidateEnvironmentPresetSound } from "../../../../../lib/server/sound-invalidation";

type RouteContext = { params: Promise<{ projectId: string; presetId: string }> };
type UpdatePresetBody = Partial<{ name: string; description: string; locked: boolean }>;

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, presetId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdatePresetBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const existing = await getDb().select().from(audioPresets).where(and(eq(audioPresets.id, presetId), eq(audioPresets.projectId, projectId))).limit(1);
  if (!existing[0]) return errorResponse(404, "AUDIO_PRESET_NOT_FOUND", "声音场预设不存在或无权访问");
  const updatedAt = new Date();
  const update: UpdatePresetBody & { assetId?: null; updatedAt: Date } = { updatedAt };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 120);
  const nextDescription = typeof body.description === "string" ? body.description.trim().slice(0, 2_000) : existing[0].description;
  const soundChanged = nextDescription !== existing[0].description;
  if (typeof body.description === "string") update.description = nextDescription ?? "";
  if (soundChanged) update.assetId = null;
  if (typeof body.locked === "boolean") update.locked = body.locked;
  await getDb().update(audioPresets).set(update).where(and(eq(audioPresets.id, presetId), eq(audioPresets.projectId, projectId)));
  if (soundChanged) await invalidateEnvironmentPresetSound(projectId, presetId, updatedAt);
  const saved = await getDb().select().from(audioPresets).where(eq(audioPresets.id, presetId)).limit(1);
  return json({ preset: saved[0] });
}
