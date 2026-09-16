import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { assets } from "../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { invalidateVisualDependencyOutputs } from "../../../../../lib/server/production-state";
import { updateVisualAssetApproval } from "../../../../../lib/visual-asset-approval";

type RouteContext = { params: Promise<{ projectId: string; assetId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, assetId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<{ visualLocked?: boolean }>(request);
  if (typeof body?.visualLocked !== "boolean") return errorResponse(400, "VISUAL_APPROVAL_REQUIRED", "请明确确认或取消确认这个视觉资产");
  const db = getDb();
  const asset = (await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId))).limit(1))[0];
  if (!asset) return errorResponse(404, "ASSET_NOT_FOUND", "项目资产不存在");
  if (body.visualLocked && (!asset.storageKey || !asset.thumbnailUrl || asset.status !== "ready")) {
    return errorResponse(409, "ASSET_MEDIA_REQUIRED", "必须先生成并归档真实图片，才能锁定为全剧标准资产");
  }
  const updatedAt = new Date();
  await db.update(assets).set({ metadataJson: updateVisualAssetApproval(asset.metadataJson, body.visualLocked), updatedAt }).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)));
  const invalidated = body.visualLocked ? { shotCount: 0, segmentCount: 0 } : await invalidateVisualDependencyOutputs(projectId, { assetIds: [assetId] }, updatedAt);
  const saved = (await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId))).limit(1))[0];
  return json({ asset: saved, invalidated });
}
