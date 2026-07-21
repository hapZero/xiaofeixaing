import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { projects } from "../../../db/schema";
import { errorResponse, json, readJson } from "../../lib/server/http";
import { getRequestUser } from "../../lib/server/request-user";

type CreateProjectBody = {
  title?: string;
  sourceType?: "upload" | "ai_script" | "canvas";
  stylePreset?: string;
  aspectRatio?: string;
  synopsis?: string;
};

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const rows = await getDb().select().from(projects).where(eq(projects.ownerId, user.id)).orderBy(desc(projects.updatedAt));
  return json({ projects: rows });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await readJson<CreateProjectBody>(request);
  const title = body?.title?.trim();
  if (!title) return errorResponse(400, "INVALID_TITLE", "项目名称不能为空");
  if (title.length > 80) return errorResponse(400, "INVALID_TITLE", "项目名称不能超过 80 个字符");

  const now = new Date();
  const project = {
    id: crypto.randomUUID(),
    ownerId: user.id,
    title,
    sourceType: body?.sourceType ?? "upload",
    status: "draft",
    stylePreset: body?.stylePreset?.trim() || "写实电影风格",
    aspectRatio: body?.aspectRatio?.trim() || "16:9",
    synopsis: body?.synopsis?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(projects).values(project);
  return json({ project }, { status: 201 });
}
