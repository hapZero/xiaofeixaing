import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { episodes, projects, shots } from "../../../../../../db/schema";
import { mergeShotGenerationPlan, shotVideoCapabilityOptions, type ShotVideoCapability } from "../../../../../lib/shot-video-capability";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string; shotId: string }> };
type UpdateShotBody = Partial<{
  title: string;
  prompt: string;
  durationMs: number;
  status: string;
  environmentPresetId: string | null;
  videoCapability: ShotVideoCapability;
  lastFrameAssetId: string | null;
}>;

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, shotId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpdateShotBody>(request);
  if (!body) return errorResponse(400, "INVALID_BODY", "请求内容不是有效的 JSON");

  const existingRows = await getDb()
    .select({ id: shots.id, generationPlanJson: shots.generationPlanJson })
    .from(shots)
    .innerJoin(episodes, eq(episodes.id, shots.episodeId))
    .innerJoin(projects, eq(projects.id, episodes.projectId))
    .where(and(eq(shots.id, shotId), eq(episodes.projectId, projectId), eq(projects.ownerId, user.id)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return errorResponse(404, "SHOT_NOT_FOUND", "分镜不存在或无权访问");

  const update: UpdateShotBody & { updatedAt: Date; generationPlanJson?: string } = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim().slice(0, 120);
  if (typeof body.prompt === "string") update.prompt = body.prompt.slice(0, 12_000);
  if (typeof body.durationMs === "number" && Number.isInteger(body.durationMs)) update.durationMs = Math.min(30_000, Math.max(1_000, body.durationMs));
  if (typeof body.status === "string") update.status = body.status.slice(0, 32);
  if (typeof body.environmentPresetId === "string" || body.environmentPresetId === null) update.environmentPresetId = body.environmentPresetId;
  if (typeof body.videoCapability === "string" || body.lastFrameAssetId === null || typeof body.lastFrameAssetId === "string") {
    const validCapability = typeof body.videoCapability === "string" && shotVideoCapabilityOptions.some((option) => option.key === body.videoCapability)
      ? body.videoCapability
      : undefined;
    update.generationPlanJson = mergeShotGenerationPlan(existing.generationPlanJson, {
      ...(validCapability ? { videoCapability: validCapability } : {}),
      ...(body.lastFrameAssetId === null || typeof body.lastFrameAssetId === "string" ? { lastFrameAssetId: body.lastFrameAssetId ?? null } : {}),
    });
  }
  await getDb().update(shots).set(update).where(eq(shots.id, shotId));
  const saved = await getDb().select().from(shots).where(eq(shots.id, shotId)).limit(1);
  return json({ shot: saved[0] });
}
