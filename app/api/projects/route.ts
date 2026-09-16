import { waitUntil } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { projects } from "../../../db/schema";
import { errorResponse, json, readJson } from "../../lib/server/http";
import { getRequestUser } from "../../lib/server/request-user";
import { executeDramaScriptGeneration } from "../../lib/server/drama-script-generation";
import { getLlmConnection } from "../../lib/server/llm";
import { executeUploadedScriptStructuring } from "../../lib/server/uploaded-script-structuring";
import { projectAspectRatios, projectStylePresets } from "../../lib/project-presets";

type CreateProjectBody = {
  title?: string;
  sourceType?: "upload" | "ai_script" | "canvas";
  stylePreset?: string;
  aspectRatio?: string;
  synopsis?: string;
  initialScript?: string;
  episodeCount?: number;
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
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const initialScript = body?.initialScript?.trim().slice(0, 100_000) || null;
  const stylePreset = projectStylePresets.includes(body?.stylePreset as (typeof projectStylePresets)[number]) ? body!.stylePreset as (typeof projectStylePresets)[number] : projectStylePresets[0];
  const aspectRatio = projectAspectRatios.includes(body?.aspectRatio as (typeof projectAspectRatios)[number]) ? body!.aspectRatio as (typeof projectAspectRatios)[number] : projectAspectRatios[0];
  const episodeCount = Math.min(100, Math.max(1, Math.round(body?.episodeCount ?? 3)));
  let llmConnection: Awaited<ReturnType<typeof getLlmConnection>> = null;
  if (sourceType !== "canvas") {
    llmConnection = await getLlmConnection(user.id).catch(() => null);
    if (!llmConnection) return errorResponse(409, "LLM_REQUIRED", "请先在设置中保存并真实测试文本智能服务，再创建剧本项目");
    if (sourceType === "ai_script" && !body?.synopsis?.trim()) return errorResponse(400, "IDEA_REQUIRED", "请描述短剧创意");
    if (sourceType === "upload" && !initialScript) return errorResponse(400, "SCRIPT_REQUIRED", "请上传或粘贴完整剧本");
  }
  const project = {
    id: crypto.randomUUID(),
    ownerId: user.id,
    title,
    sourceType,
    status: sourceType === "canvas" ? "draft" : sourceType === "ai_script" ? "script_generating" : "script_structuring",
    stylePreset,
    aspectRatio,
    synopsis: body?.synopsis?.trim() || null,
    sourceText: sourceType === "upload" ? initialScript : null,
    createdAt: now,
    updatedAt: now,
  };
  const statements = [
    getD1().prepare(
      "INSERT INTO projects (id, owner_id, title, source_type, status, style_preset, aspect_ratio, synopsis, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      project.id,
      project.ownerId,
      project.title,
      project.sourceType,
      project.status,
      project.stylePreset,
      project.aspectRatio,
      project.synopsis,
      project.sourceText,
      nowSeconds,
      nowSeconds,
    ),
  ];
  if (sourceType !== "canvas") {
    const episodeDrafts = [{ title: "第 1 集", summary: project.synopsis, scriptText: sourceType === "upload" ? initialScript : null }];
    episodeDrafts.forEach((episode, index) => statements.push(
      getD1().prepare("INSERT INTO episodes (id, project_id, episode_number, title, summary, script_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), project.id, index + 1, episode.title, episode.summary, episode.scriptText, episode.scriptText ? "generated" : "draft", nowSeconds, nowSeconds),
    ));
  }
  const textJobId = sourceType !== "canvas" ? crypto.randomUUID() : null;
  const textJobCapability = sourceType === "upload" ? "llm_structure" : "llm_script";
  if (textJobId) statements.push(getD1().prepare(
    "INSERT INTO generation_jobs (id, owner_id, project_id, entity_type, entity_id, capability, workflow_binding_id, status, comfy_prompt_id, payload_json, result_json, error_code, error_message, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, 'project', ?, ?, NULL, 'running', NULL, ?, NULL, NULL, NULL, ?, NULL, ?, ?)",
  ).bind(textJobId, user.id, project.id, project.id, textJobCapability, JSON.stringify(sourceType === "upload" ? { sourceLength: initialScript?.length ?? 0, stylePreset, aspectRatio } : { idea: project.synopsis, episodeCount, stylePreset, aspectRatio }), nowSeconds, nowSeconds, nowSeconds));
  await getD1().batch(statements);

  if (sourceType !== "canvas" && llmConnection && textJobId) {
    waitUntil(sourceType === "upload"
      ? executeUploadedScriptStructuring({ ownerId: user.id, jobId: textJobId, project, connection: llmConnection })
      : executeDramaScriptGeneration({ ownerId: user.id, jobId: textJobId, project, episodeCount, connection: llmConnection, phase: "outline_only" }));
    return json({ project, generated: false, episodeCount: 1, generationJob: { id: textJobId, status: "running", capability: textJobCapability } }, { status: 202 });
  }

  return json({ project, generated: false, episodeCount: sourceType === "canvas" ? 0 : 1 }, { status: 201 });
}
