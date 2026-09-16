import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { assets, projects } from "../../../db/schema";
import { errorResponse, json } from "../../lib/server/http";
import { getRequestUser } from "../../lib/server/request-user";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");

  const rows = await getDb()
    .select({ asset: assets, project: projects })
    .from(assets)
    .innerJoin(projects, eq(assets.projectId, projects.id))
    .where(eq(projects.ownerId, user.id))
    .orderBy(desc(assets.updatedAt));

  return json({
    assets: rows.map(({ asset, project }) => ({
      ...asset,
      contentUrl: asset.storageKey ? `/api/assets/${asset.id}/content` : asset.thumbnailUrl,
      project: {
        id: project.id,
        title: project.title,
        sourceType: project.sourceType,
        status: project.status,
        stylePreset: project.stylePreset,
        aspectRatio: project.aspectRatio,
        synopsis: project.synopsis,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    })),
  });
}
