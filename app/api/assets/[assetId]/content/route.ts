import { eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../db";
import { assets } from "../../../../../db/schema";
import { errorResponse } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { assetId } = await context.params;
  const asset = (await getDb().select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset || !await getOwnedProject(asset.projectId, user.id)) return errorResponse(404, "ASSET_NOT_FOUND", "素材不存在或无权访问");
  if (!asset.storageKey) return errorResponse(404, "ASSET_FILE_NOT_FOUND", "素材文件尚未生成");
  const object = await getMediaBucket().get(asset.storageKey);
  if (!object) return errorResponse(404, "ASSET_FILE_NOT_FOUND", "素材文件不存在");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
