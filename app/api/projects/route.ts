import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { projects } from "../../../db/schema";
import { errorResponse, json, readJson } from "../../lib/server/http";
import { getRequestUser } from "../../lib/server/request-user";

type CreateProjectBody = {
  title?: string;
  sourceType?: "upload" | "ai_script" | "canvas";
  stylePreset?: string;
  aspectRatio?: string;
  synopsis?: string;
  initialScript?: string;
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

  const sourceType = body?.sourceType ?? "upload";
  if (!["upload", "ai_script", "canvas"].includes(sourceType)) {
    return errorResponse(400, "INVALID_SOURCE_TYPE", "不支持的项目创建方式");
  }

  const now = new Date();
  const episodeId = sourceType === "canvas" ? null : crypto.randomUUID();
  const initialScript = body?.initialScript?.trim().slice(0, 100_000) || null;
  const project = {
    id: crypto.randomUUID(),
    ownerId: user.id,
    title,
    sourceType,
    status: sourceType === "canvas" ? "draft" : "scripting",
    stylePreset: body?.stylePreset?.trim() || "写实电影风格",
    aspectRatio: body?.aspectRatio?.trim() || "16:9",
    synopsis: body?.synopsis?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  const statements = [
    getD1().prepare(
      "INSERT INTO projects (id, owner_id, title, source_type, status, style_preset, aspect_ratio, synopsis, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      project.id,
      project.ownerId,
      project.title,
      project.sourceType,
      project.status,
      project.stylePreset,
      project.aspectRatio,
      project.synopsis,
      now.getTime(),
      now.getTime(),
    ),
  ];
  if (episodeId) {
    statements.push(
      getD1().prepare(
        "INSERT INTO episodes (id, project_id, episode_number, title, summary, script_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        episodeId,
        project.id,
        1,
        "第 1 集",
        project.synopsis,
        initialScript,
        initialScript ? "generated" : "draft",
        now.getTime(),
        now.getTime(),
      ),
    );
  }
  await getD1().batch(statements);
  return json({ project, episodeId }, { status: 201 });
}
