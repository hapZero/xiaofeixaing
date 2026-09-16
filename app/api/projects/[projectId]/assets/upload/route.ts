import { getDb, getMediaBucket } from "../../../../../../db";
import { assets } from "../../../../../../db/schema";
import { errorResponse, json } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse(400, "FILE_REQUIRED", "请选择要上传的文件");
  if (file.size > 100 * 1024 * 1024) return errorResponse(413, "FILE_TOO_LARGE", "单个素材不能超过 100 MB");
  const mediaType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (!mediaType) return errorResponse(415, "MEDIA_TYPE_UNSUPPORTED", "当前支持图片、视频和音频素材");
  const id = crypto.randomUUID();
  const extension = file.name.match(/\.[a-z0-9]{2,8}$/i)?.[0] ?? (mediaType === "image" ? ".png" : mediaType === "video" ? ".mp4" : ".wav");
  const storageKey = `uploads/${user.id}/${projectId}/${id}${extension}`;
  await getMediaBucket().put(storageKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  const now = new Date();
  const asset = { id, projectId, episodeId: null, assetType: "material", name: file.name.slice(0, 160), status: "ready", storageKey, thumbnailUrl: `/api/assets/${id}/content`, metadataJson: JSON.stringify({ source: "canvas_upload", mediaType, size: file.size }), createdAt: now, updatedAt: now };
  await getDb().insert(assets).values(asset);
  return json({ asset, mediaType }, { status: 201 });
}
