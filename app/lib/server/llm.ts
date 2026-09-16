import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { serviceConnections } from "../../../db/schema";
import { readServiceTestMetadata } from "../service-readiness";
import { decryptCredential } from "./credentials";
import { extractJson } from "./llm-json";
import { formatOutlineForEpisodeGeneration, validateScriptCharacterRoster } from "../drama-outline";

export type LlmConnection = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

function dramaOutlineTimeoutMs() {
  return 300_000;
}

function dramaEpisodesTimeoutMs(episodeCount: number) {
  return Math.min(900_000, 240_000 + Math.max(1, episodeCount) * 120_000);
}

export function dramaAnalysisTimeoutMs(episodeCount: number, scriptLength = 0) {
  return Math.min(900_000, 300_000 + Math.max(1, episodeCount) * 120_000 + Math.floor(scriptLength / 1_000) * 15_000);
}

export type SegmentContinuityReview = {
  passed: boolean;
  score: number;
  summary: string;
  issues: Array<{
    category: "character" | "scene" | "action" | "shot_coverage" | "other";
    severity: "warning" | "error";
    shotNumbers: number[];
    message: string;
    suggestion: string;
  }>;
};

export type GeneratedDramaCharacter = {
  name: string;
  roleType: string;
  visualImage: string;
  coreTags: string;
  background: string;
  growthHistory: string;
  personality: string;
  relationships: string;
  growthArc: string;
};

export type GeneratedDramaOutline = {
  title: string;
  logline: string;
  genre: string;
  coreHooks: string[];
  targetAudience: string;
  world: { premise: string; rules: string[]; tone: string };
  relationships: Array<{ from: string; to: string; relation: string; development: string }>;
  characters: GeneratedDramaCharacter[];
};

export type GeneratedDrama = GeneratedDramaOutline & {
  episodes: Array<{ title: string; summary: string; scriptText: string }>;
};

export type GeneratedEpisode = {
  title: string;
  summary: string;
  scriptText: string;
};

export type StructuredUploadedDrama = {
  title: string;
  logline: string;
  narrationMode: "dialogue" | "narration";
  world: { premise: string; rules: string[]; tone: string };
  relationships: Array<{ from: string; to: string; relation: string; development: string }>;
  episodes: Array<{ episodeNumber: number; title: string; summary: string; scriptText: string }>;
};

export type StructuredDramaAnalysis = {
  logline: string;
  narrationMode: "dialogue" | "narration";
  world: { premise: string; rules: string[]; tone: string };
  relationships: Array<{ from: string; to: string; relation: string; development: string }>;
  characters: Array<{
    name: string;
    description: string;
    voiceDescription: string;
    episodeNumbers: number[];
    forms: Array<{ name: string; description: string; episodeNumbers: number[] }>;
  }>;
  scenes: Array<{
    name: string;
    description: string;
    timeOfDay: string;
    interiorExterior: "内" | "外" | "内外";
    episodeNumbers: number[];
    visualContinuity: string;
  }>;
  props: Array<{ name: string; description: string; episodeNumbers: number[] }>;
  episodes: Array<{
    episodeNumber: number;
    title: string;
    summary: string;
    scriptText: string;
    segments: Array<{
      title: string;
      synopsis: string;
      sceneName: string;
      shots: Array<{
        title: string;
        prompt: string;
        durationSeconds: number;
        shotType: "visual" | "dialogue" | "voiceover" | "narration";
        dialogue: Array<{ speaker: string; lineType: "dialogue" | "voiceover" | "narration"; text: string; emotion: string; mouthOpen: boolean }>;
      }>;
    }>;
  }>;
};

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

export async function getServiceModelConnection(ownerId: string, kind: "llm" | "vision"): Promise<LlmConnection | null> {
  const row = (await getDb().select().from(serviceConnections).where(and(
    eq(serviceConnections.ownerId, ownerId),
    eq(serviceConnections.kind, kind),
    eq(serviceConnections.enabled, true),
  )).limit(1))[0];
  if (!row || !row.model || !row.secretCiphertext || readServiceTestMetadata(row.configJson).lastTestStatus !== "succeeded") return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: await decryptCredential(row.secretCiphertext),
  };
}

export async function getLlmConnection(ownerId: string): Promise<LlmConnection | null> {
  return getServiceModelConnection(ownerId, "llm");
}

export async function getVisionConnection(ownerId: string): Promise<LlmConnection | null> {
  return getServiceModelConnection(ownerId, "vision");
}

export async function testLlmConnection(connection: Omit<LlmConnection, "id">): Promise<{ model: string; reply: string }> {
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [{ role: "user", content: "只回复：连接成功" }],
      temperature: 0,
      max_tokens: 16,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`LLM_CONNECTION_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return { model: connection.model, reply: data.choices?.[0]?.message?.content?.trim() || "连接成功" };
}

export async function testVisionConnection(connection: Omit<LlmConnection, "id">): Promise<{ model: string; reply: string }> {
  const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3iQAAAAASUVORK5CYII=";
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [{ role: "user", content: [{ type: "text", text: "确认你能读取这张测试图片，只回复：视觉连接成功" }, { type: "image_url", image_url: { url: testImage, detail: "low" } }] }],
      temperature: 0,
      max_tokens: 24,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`VISION_CONNECTION_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return { model: connection.model, reply: data.choices?.[0]?.message?.content?.trim() || "视觉连接成功" };
}

function validateContinuityReview(value: unknown): SegmentContinuityReview {
  if (!value || typeof value !== "object") throw new Error("VISION_REVIEW_FORMAT_INVALID");
  const source = value as Record<string, unknown>;
  const issues = (Array.isArray(source.issues) ? source.issues : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const rawCategory = cleanText(item.category, 40);
    const category = (["character", "scene", "action", "shot_coverage", "other"].includes(rawCategory) ? rawCategory : "other") as SegmentContinuityReview["issues"][number]["category"];
    const rawSeverity = cleanText(item.severity, 20);
    return [{
      category,
      severity: rawSeverity === "error" ? "error" as const : "warning" as const,
      shotNumbers: Array.isArray(item.shotNumbers) ? item.shotNumbers.filter((number): number is number => Number.isInteger(number) && number > 0).slice(0, 30) : [],
      message: cleanText(item.message, 1_000, "发现连续性风险"),
      suggestion: cleanText(item.suggestion, 1_000),
    }];
  });
  const score = Math.max(0, Math.min(100, Number(source.score) || 0));
  return { passed: source.passed === true && !issues.some((issue) => issue.severity === "error"), score, summary: cleanText(source.summary, 2_000), issues };
}

export async function reviewSegmentContinuity(connection: LlmConnection, input: {
  contactSheetDataUrl: string;
  projectStyle: string;
  segmentTitle: string;
  segmentSynopsis: string | null;
  shots: Array<{ number: number; durationSeconds: number; prompt: string; characters: string[]; scene: string | null; dialogue: string[] }>;
}): Promise<SegmentContinuityReview> {
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [
        { role: "system", content: "你是商业短剧的视觉连续性审片导演。只输出合法 JSON。联系宫格图按时间从左到右、从上到下排列。必须依据画面证据与分镜计划检查角色身份/服装、场景空间/光线、动作衔接以及计划中的分镜是否实际出现；不确定时列为 warning，不能凭空判定通过。" },
        { role: "user", content: [
          { type: "text", text: `项目风格：${input.projectStyle}\n片段：${input.segmentTitle}\n叙事目标：${input.segmentSynopsis || "无"}\n分镜计划：${JSON.stringify(input.shots)}\n\n返回：{"passed":true,"score":0到100,"summary":"审片结论","issues":[{"category":"character/scene/action/shot_coverage/other","severity":"warning/error","shotNumbers":[1],"message":"证据与问题","suggestion":"具体重做建议"}]}` },
          { type: "image_url", image_url: { url: input.contactSheetDataUrl, detail: "high" } },
        ] },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`VISION_REVIEW_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("VISION_REVIEW_EMPTY");
  return validateContinuityReview(extractJson(content));
}

function parseGeneratedCharacters(raw: unknown) {
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const name = cleanText(source.name, 40);
    if (!name) return [];
    return [{
      name,
      roleType: cleanText(source.roleType, 40, "角色"),
      visualImage: cleanText(source.visualImage, 500),
      coreTags: cleanText(source.coreTags, 200),
      background: cleanText(source.background, 1_000),
      growthHistory: cleanText(source.growthHistory, 1_000),
      personality: cleanText(source.personality, 500),
      relationships: cleanText(source.relationships, 1_000),
      growthArc: cleanText(source.growthArc, 1_000),
    }];
  }).slice(0, 20);
}

function validateDramaOutline(value: unknown): GeneratedDramaOutline {
  if (!value || typeof value !== "object") throw new Error("LLM_OUTLINE_FORMAT_INVALID");
  const source = value as Partial<GeneratedDramaOutline> & Record<string, unknown>;
  const world = source.world && typeof source.world === "object" && !Array.isArray(source.world) ? source.world as Record<string, unknown> : {};
  const relationships = (Array.isArray(source.relationships) ? source.relationships : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const from = cleanText(item.from, 40);
    const to = cleanText(item.to, 40);
    return from && to ? [{ from, to, relation: cleanText(item.relation, 200), development: cleanText(item.development, 1_000) }] : [];
  });
  const characters = parseGeneratedCharacters(source.characters);
  const logline = typeof source.logline === "string" ? source.logline.trim().slice(0, 500) : "";
  const genre = cleanText(source.genre, 120);
  const coreHooks = Array.isArray(source.coreHooks) ? source.coreHooks.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 12) : [];
  const targetAudience = cleanText(source.targetAudience, 120);
  if (!logline) throw new Error("LLM_OUTLINE_LOGLINE_MISSING");
  if (!genre) throw new Error("LLM_OUTLINE_GENRE_MISSING");
  if (coreHooks.length < 2) throw new Error("LLM_OUTLINE_HOOKS_MISSING");
  if (!targetAudience) throw new Error("LLM_OUTLINE_AUDIENCE_MISSING");
  if (characters.length < 1) throw new Error("LLM_OUTLINE_CHARACTERS_MISSING");
  for (const character of characters) {
    if (!character.visualImage || !character.roleType) throw new Error(`LLM_OUTLINE_CHARACTER_INCOMPLETE:${character.name}`);
  }
  return {
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 80) : "未命名短剧",
    logline,
    genre,
    coreHooks,
    targetAudience,
    world: {
      premise: cleanText(world.premise, 3_000),
      rules: Array.isArray(world.rules) ? world.rules.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 30) : [],
      tone: cleanText(world.tone, 500),
    },
    relationships,
    characters,
  };
}

function validateDramaEpisodes(value: unknown, episodeCount: number, rosterNames: string[]) {
  if (!value || typeof value !== "object") throw new Error("LLM_EPISODES_FORMAT_INVALID");
  const source = value as { episodes?: unknown };
  if (!Array.isArray(source.episodes) || source.episodes.length !== episodeCount) {
    throw new Error(`LLM_EPISODE_COUNT_INVALID:${Array.isArray(source.episodes) ? source.episodes.length : 0}/${episodeCount}`);
  }
  return source.episodes.map((episode, index) => {
    if (!episode || typeof episode !== "object") throw new Error(`LLM_EPISODE_INVALID:${index + 1}`);
    const item = episode as { title?: unknown; summary?: unknown; scriptText?: unknown };
    if (typeof item.title !== "string" || typeof item.summary !== "string" || typeof item.scriptText !== "string" || !item.scriptText.trim()) {
      throw new Error(`LLM_EPISODE_INVALID:${index + 1}`);
    }
    const scriptText = item.scriptText.trim().slice(0, 100_000);
    validateScriptCharacterRoster(scriptText, rosterNames);
    return { title: item.title.trim().slice(0, 120), summary: item.summary.trim().slice(0, 1_000), scriptText };
  });
}

function validateDrama(value: unknown, episodeCount: number): GeneratedDrama {
  const outline = validateDramaOutline(value);
  const episodes = validateDramaEpisodes(value, episodeCount, outline.characters.map((character) => character.name));
  return { ...outline, episodes };
}

function validateUploadedDramaStructure(value: unknown, sourceLength: number): StructuredUploadedDrama {
  if (!value || typeof value !== "object") throw new Error("LLM_STRUCTURE_FORMAT_INVALID");
  const source = value as Record<string, unknown>;
  const rawEpisodes = Array.isArray(source.episodes) ? source.episodes : [];
  if (!rawEpisodes.length || rawEpisodes.length > 100) throw new Error(`LLM_STRUCTURE_EPISODE_COUNT_INVALID:${rawEpisodes.length}`);
  const episodes = rawEpisodes.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`LLM_STRUCTURE_EPISODE_INVALID:${index + 1}`);
    const item = raw as Record<string, unknown>;
    const scriptText = cleanText(item.scriptText, 100_000);
    if (!scriptText) throw new Error(`LLM_STRUCTURE_EPISODE_SCRIPT_MISSING:${index + 1}`);
    return {
      episodeNumber: index + 1,
      title: cleanText(item.title, 120, `第 ${index + 1} 集`),
      summary: cleanText(item.summary, 2_000),
      scriptText,
    };
  });
  const structuredLength = episodes.reduce((total, episode) => total + episode.scriptText.length, 0);
  if (sourceLength >= 1_000 && structuredLength < sourceLength * 0.45) {
    throw new Error(`LLM_STRUCTURE_INCOMPLETE:${structuredLength}/${sourceLength}`);
  }
  const world = source.world && typeof source.world === "object" && !Array.isArray(source.world) ? source.world as Record<string, unknown> : {};
  const relationships = (Array.isArray(source.relationships) ? source.relationships : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const from = cleanText(item.from, 40);
    const to = cleanText(item.to, 40);
    return from && to ? [{ from, to, relation: cleanText(item.relation, 200), development: cleanText(item.development, 1_000) }] : [];
  });
  return {
    title: cleanText(source.title, 80, "未命名短剧"),
    logline: cleanText(source.logline, 500),
    narrationMode: source.narrationMode === "narration" ? "narration" : "dialogue",
    world: {
      premise: cleanText(world.premise, 3_000),
      rules: Array.isArray(world.rules) ? world.rules.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 30) : [],
      tone: cleanText(world.tone, 500),
    },
    relationships,
    episodes,
  };
}

function cleanText(value: unknown, maximum: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : fallback;
}

function cleanEpisodeNumbers(value: unknown, episodeCount: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= episodeCount))].sort((a, b) => a - b);
}

function validateDramaAnalysis(value: unknown, episodeCount: number): StructuredDramaAnalysis {
  if (!value || typeof value !== "object") throw new Error("LLM_ANALYSIS_FORMAT_INVALID");
  const source = value as Record<string, unknown>;
  const list = (key: string) => Array.isArray(source[key]) ? source[key] as unknown[] : [];
  const rawEpisodes = list("episodes");
  const inferredEpisodeCount = Math.max(
    episodeCount,
    rawEpisodes.length,
    ...rawEpisodes.map((raw) => raw && typeof raw === "object" && Number.isInteger((raw as Record<string, unknown>).episodeNumber) ? Number((raw as Record<string, unknown>).episodeNumber) : 0),
  );
  const characters = list("characters").map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`LLM_CHARACTER_INVALID:${index + 1}`);
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 40);
    if (!name) throw new Error(`LLM_CHARACTER_INVALID:${index + 1}`);
    const forms = (Array.isArray(item.forms) ? item.forms : []).map((formRaw, formIndex) => {
      if (!formRaw || typeof formRaw !== "object") throw new Error(`LLM_CHARACTER_FORM_INVALID:${index + 1}:${formIndex + 1}`);
      const form = formRaw as Record<string, unknown>;
      return {
        name: cleanText(form.name, 40, "基础形象"),
        description: cleanText(form.description, 2_000),
        episodeNumbers: cleanEpisodeNumbers(form.episodeNumbers, inferredEpisodeCount),
      };
    });
    return {
      name,
      description: cleanText(item.description, 3_000),
      voiceDescription: cleanText(item.voiceDescription, 1_000),
      episodeNumbers: cleanEpisodeNumbers(item.episodeNumbers, inferredEpisodeCount),
      forms: forms.length ? forms : [{ name: "基础形象", description: cleanText(item.description, 2_000), episodeNumbers: cleanEpisodeNumbers(item.episodeNumbers, inferredEpisodeCount) }],
    };
  });
  const scenes = list("scenes").map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`LLM_SCENE_INVALID:${index + 1}`);
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 60);
    if (!name) throw new Error(`LLM_SCENE_INVALID:${index + 1}`);
    const interiorExterior = cleanText(item.interiorExterior, 4);
    return {
      name,
      description: cleanText(item.description, 3_000),
      timeOfDay: cleanText(item.timeOfDay, 20),
      interiorExterior: (["内", "外", "内外"].includes(interiorExterior) ? interiorExterior : "内外") as "内" | "外" | "内外",
      episodeNumbers: cleanEpisodeNumbers(item.episodeNumbers, inferredEpisodeCount),
      visualContinuity: cleanText(item.visualContinuity, 2_000),
    };
  });
  const props = list("props").map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`LLM_PROP_INVALID:${index + 1}`);
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 60);
    if (!name) throw new Error(`LLM_PROP_INVALID:${index + 1}`);
    return { name, description: cleanText(item.description, 2_000), episodeNumbers: cleanEpisodeNumbers(item.episodeNumbers, inferredEpisodeCount) };
  });
  const relationships = list("relationships").flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const from = cleanText(item.from, 40);
    const to = cleanText(item.to, 40);
    return from && to ? [{ from, to, relation: cleanText(item.relation, 200), development: cleanText(item.development, 1_000) }] : [];
  });
  const episodes = rawEpisodes.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`LLM_ANALYSIS_EPISODE_INVALID:${index + 1}`);
    const item = raw as Record<string, unknown>;
    const episodeNumber = Number.isInteger(item.episodeNumber) ? item.episodeNumber as number : index + 1;
    const segments = (Array.isArray(item.segments) ? item.segments : []).map((segmentRaw, segmentIndex) => {
      if (!segmentRaw || typeof segmentRaw !== "object") throw new Error(`LLM_SEGMENT_INVALID:${episodeNumber}:${segmentIndex + 1}`);
      const segment = segmentRaw as Record<string, unknown>;
      const shots = (Array.isArray(segment.shots) ? segment.shots : []).map((shotRaw, shotIndex) => {
        if (!shotRaw || typeof shotRaw !== "object") throw new Error(`LLM_SHOT_INVALID:${episodeNumber}:${segmentIndex + 1}:${shotIndex + 1}`);
        const shot = shotRaw as Record<string, unknown>;
        const rawType = cleanText(shot.shotType, 20);
        const shotType = (["visual", "dialogue", "voiceover", "narration"].includes(rawType) ? rawType : "visual") as "visual" | "dialogue" | "voiceover" | "narration";
        const dialogue = (Array.isArray(shot.dialogue) ? shot.dialogue : []).flatMap((lineRaw) => {
          if (!lineRaw || typeof lineRaw !== "object") return [];
          const line = lineRaw as Record<string, unknown>;
          const text = cleanText(line.text, 2_000);
          if (!text) return [];
          const rawLineType = cleanText(line.lineType, 20);
          return [{
            speaker: cleanText(line.speaker, 40),
            lineType: (["dialogue", "voiceover", "narration"].includes(rawLineType) ? rawLineType : "dialogue") as "dialogue" | "voiceover" | "narration",
            text,
            emotion: cleanText(line.emotion, 80),
            mouthOpen: line.mouthOpen !== false,
          }];
        });
        return {
          title: cleanText(shot.title, 120, `镜头 ${shotIndex + 1}`),
          prompt: cleanText(shot.prompt, 8_000),
          durationSeconds: Math.min(20, Math.max(1, typeof shot.durationSeconds === "number" ? shot.durationSeconds : 5)),
          shotType,
          dialogue,
        };
      });
      return {
        title: cleanText(segment.title, 120, `片段 ${segmentIndex + 1}`),
        synopsis: cleanText(segment.synopsis, 2_000),
        sceneName: cleanText(segment.sceneName, 60),
        shots,
      };
    }).filter((segment) => segment.shots.length > 0);
    return {
      episodeNumber,
      title: cleanText(item.title, 120, `第 ${episodeNumber} 集`),
      summary: cleanText(item.summary, 2_000),
      scriptText: cleanText(item.scriptText, 100_000),
      segments,
    };
  });
  if (episodeCount === 1 && episodes.length > 1 && episodes.some((episode) => !episode.scriptText)) {
    throw new Error("LLM_ANALYSIS_EPISODE_SCRIPT_MISSING");
  }
  if (!characters.length || !scenes.length || !episodes.some((episode) => episode.segments.length)) throw new Error("LLM_ANALYSIS_INCOMPLETE");
  const world = source.world && typeof source.world === "object" && !Array.isArray(source.world) ? source.world as Record<string, unknown> : {};
  return {
    logline: cleanText(source.logline, 500),
    narrationMode: source.narrationMode === "narration" ? "narration" : "dialogue",
    world: {
      premise: cleanText(world.premise, 3_000),
      rules: Array.isArray(world.rules) ? world.rules.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 30) : [],
      tone: cleanText(world.tone, 500),
    },
    relationships,
    characters,
    scenes,
    props,
    episodes,
  };
}

export async function generateDramaOutline(connection: LlmConnection, input: {
  idea: string;
  episodeCount: number;
  stylePreset: string;
  aspectRatio: string;
}): Promise<GeneratedDramaOutline> {
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [
        { role: "system", content: "你是商业短剧策划编辑。只输出合法 JSON，不要使用 Markdown。此步骤只建立剧本摘要和人物小传，不要写分集正文。必须给出故事类型、目标受众、至少 2 个核心梗、一句话故事，以及至少 1 位主角和若干配角的小传。" },
        { role: "user", content: `根据以下创意，为 ${input.episodeCount} 集短剧建立剧本摘要与人物小传。视觉风格：${input.stylePreset}；画面比例：${input.aspectRatio}。\n创意：${input.idea}\n\n返回：{"title":"剧名","logline":"一句话故事","genre":"故事类型","coreHooks":["核心梗1","核心梗2"],"targetAudience":"目标受众","world":{"premise":"世界观与叙事前提","rules":["规则"],"tone":"基调"},"relationships":[{"from":"人物A","to":"人物B","relation":"关系","development":"变化"}],"characters":[{"name":"姓名","roleType":"主角/配角","visualImage":"视觉形象","coreTags":"核心标签","background":"身份背景","growthHistory":"成长经历","personality":"性格特点","relationships":"人物关系","growthArc":"成长变化"}]}` },
      ],
      temperature: 0.55,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(dramaOutlineTimeoutMs()),
  });
  if (!response.ok) throw new Error(`LLM_OUTLINE_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM_OUTLINE_EMPTY");
  return validateDramaOutline(extractJson(content));
}

export async function generateDramaEpisodes(connection: LlmConnection, input: {
  idea: string;
  episodeCount: number;
  stylePreset: string;
  aspectRatio: string;
  outline: GeneratedDramaOutline;
}): Promise<Array<{ title: string; summary: string; scriptText: string }>> {
  const rosterNames = input.outline.characters.map((character) => character.name);
  const lockPrompt = formatOutlineForEpisodeGeneration({
    logline: input.outline.logline,
    genre: input.outline.genre,
    coreHooks: input.outline.coreHooks,
    targetAudience: input.outline.targetAudience,
    premise: input.outline.world.premise,
    tone: input.outline.world.tone,
    characters: input.outline.characters,
    relationships: input.outline.relationships,
  });
  let repairHint = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({
        model: connection.model,
        messages: [
          { role: "system", content: "你是商业短剧编剧。只输出合法 JSON，不要使用 Markdown。必须严格依据已锁定的剧本摘要与人物小传写分集正文。出场人物和对白说话人只能使用人物白名单中的正式姓名，禁止发明新角色名或给已有角色改名。允许无具体姓名的群众描述（数名弟子、路人、旁白、画外音）。" },
          { role: "user", content: `原始创意：${input.idea}\n视觉风格：${input.stylePreset}；画面比例：${input.aspectRatio}\n\n${lockPrompt}${repairHint}\n\n请生成 ${input.episodeCount} 集完整分集剧本。每集必须包含场景标题（日/夜、内/外）、出场人物（写正式姓名）、动作、对白。返回：{"episodes":[{"title":"第1集标题","summary":"本集摘要","scriptText":"完整剧本"}]}` },
        ],
        temperature: 0.45,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(dramaEpisodesTimeoutMs(input.episodeCount)),
    });
    if (!response.ok) throw new Error(`LLM_EPISODES_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM_EPISODES_EMPTY");
    try {
      return validateDramaEpisodes(extractJson(content), input.episodeCount, rosterNames);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "LLM_EPISODES_FAILED";
      if (attempt === 0 && reason.startsWith("LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:")) {
        repairHint = `\n\n【必须修正】上次结果使用了未在白名单的人物：${reason.slice("LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:".length)}。请全部改回白名单中的正式姓名，不要新增或改名。`;
        continue;
      }
      throw error;
    }
  }
  throw new Error("LLM_EPISODES_FAILED");
}

export async function generateDramaScript(connection: LlmConnection, input: {
  idea: string;
  episodeCount: number;
  stylePreset: string;
  aspectRatio: string;
}): Promise<GeneratedDrama> {
  const outline = await generateDramaOutline(connection, input);
  const episodes = await generateDramaEpisodes(connection, { ...input, outline });
  return { ...outline, episodes };
}

export async function structureUploadedDrama(connection: LlmConnection, input: {
  scriptText: string;
  stylePreset: string;
  aspectRatio: string;
}): Promise<StructuredUploadedDrama> {
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [
        { role: "system", content: "你是商业短剧的责任编辑。只输出合法 JSON，不使用 Markdown。你的任务是识别原剧本已有的分集边界；如果原稿没有明确分集，则按叙事节奏拆为可制作的分集。必须完整保留原稿中的所有场景、动作、对白和旁白，只能整理格式与分集，不能摘要代替剧本、不能删减情节。" },
        { role: "user", content: `视觉风格：${input.stylePreset}；画面比例：${input.aspectRatio}。\n\n请先建立故事大纲，再把下面完整剧本整理为分集剧本。返回：{"title":"剧名","logline":"一句话故事","narrationMode":"dialogue或narration","world":{"premise":"世界观","rules":["规则"],"tone":"基调"},"relationships":[{"from":"人物","to":"人物","relation":"关系","development":"变化"}],"episodes":[{"title":"分集标题","summary":"分集摘要","scriptText":"该集完整原文剧本"}]}\n\n原始完整剧本：\n${input.scriptText}` },
      ],
      temperature: 0.15,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`LLM_STRUCTURE_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM_STRUCTURE_EMPTY");
  return validateUploadedDramaStructure(extractJson(content), input.scriptText.length);
}

export async function generateEpisodeScript(connection: LlmConnection, input: {
  projectTitle: string;
  synopsis: string;
  storyOutline?: string;
  allowedCharacterNames: string[];
  episodeNumber: number;
  stylePreset: string;
  aspectRatio: string;
  precedingEpisodes: Array<{ episodeNumber: number; title: string; summary: string | null; scriptText: string | null }>;
  existingEpisode?: { title: string; summary: string | null; scriptText: string | null };
}): Promise<GeneratedEpisode> {
  const continuity = input.precedingEpisodes.slice(-5).map((episode) => (
    `第${episode.episodeNumber}集《${episode.title}》\n摘要：${episode.summary || "无"}\n剧本：${(episode.scriptText || "").slice(0, 8_000)}`
  )).join("\n\n");
  const existing = input.existingEpisode?.scriptText
    ? `\n当前版本（用于保留有效剧情并整体重写）：\n${input.existingEpisode.scriptText.slice(0, 20_000)}`
    : "";
  const lockedOutline = input.storyOutline ? `\n${input.storyOutline}` : "";
  let repairHint = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({
        model: connection.model,
        messages: [
          { role: "system", content: "你是商业短剧编剧。只输出合法 JSON。必须严格遵循已锁定的剧本摘要与人物白名单，续写或重写的分集必须与前文连续。出场人物和对白说话人只能使用白名单中的正式姓名，禁止发明新角色名或给已有角色改名。允许无具体姓名的群众描述（数名弟子、路人、旁白、画外音）。" },
          { role: "user", content: `为短剧《${input.projectTitle}》创作第 ${input.episodeNumber} 集。原始创意：${input.synopsis || "根据已有分集延续"}。视觉风格：${input.stylePreset}；画面比例：${input.aspectRatio}。${lockedOutline}${repairHint}\n\n前情：\n${continuity || "这是第一集"}${existing}\n\n返回：{"title":"本集标题","summary":"本集摘要","scriptText":"完整可拍摄剧本"}` },
        ],
        temperature: 0.45,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`LLM_EPISODE_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM_EPISODE_EMPTY");
    const value = extractJson(content);
    if (!value || typeof value !== "object") throw new Error("LLM_EPISODE_FORMAT_INVALID");
    const source = value as Record<string, unknown>;
    const title = cleanText(source.title, 120);
    const summary = cleanText(source.summary, 2_000);
    const scriptText = cleanText(source.scriptText, 100_000);
    if (!title || !summary || !scriptText) throw new Error("LLM_EPISODE_FORMAT_INVALID");
    try {
      validateScriptCharacterRoster(scriptText, input.allowedCharacterNames);
      return { title, summary, scriptText };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "LLM_EPISODE_FAILED";
      if (attempt === 0 && reason.startsWith("LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:")) {
        repairHint = `\n\n【必须修正】上次结果使用了未在白名单的人物：${reason.slice("LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:".length)}。请全部改回白名单中的正式姓名，不要新增或改名。`;
        continue;
      }
      throw error;
    }
  }
  throw new Error("LLM_EPISODE_FAILED");
}

export async function analyzeDramaScript(connection: LlmConnection, input: {
  title: string;
  episodes: Array<{ episodeNumber: number; title: string; summary: string | null; scriptText: string }>;
  stylePreset: string;
  aspectRatio: string;
  availableVideoCapabilities?: string;
}): Promise<StructuredDramaAnalysis> {
  const script = input.episodes.map((episode) => `\n=== 第${episode.episodeNumber}集 ${episode.title} ===\n${episode.scriptText}`).join("\n").slice(0, 120_000);
  const response = await fetch(chatCompletionsUrl(connection.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
    body: JSON.stringify({
      model: connection.model,
      messages: [
        { role: "system", content: "你是商业短剧的剧本统筹、导演和制片。必须只输出合法 JSON。你的任务是把完整剧本结构化为真实分集、项目级资产，以及片段-分镜生产草案。输入可能是一整部多集剧本，也可能已经按集分开；必须忠实识别原有集数，不要把多集内容挤进一集，也不要杜撰剧本中不存在的核心角色或剧情。片段是用户生产单位，一个片段包含连续的多个分镜。每个分镜描述必须包含景别、机位、运镜、角色动作表情、场景、必要道具、对白/旁白、是否张嘴和时长。" },
        { role: "user", content: `分析短剧《${input.title}》。视觉风格：${input.stylePreset}；画面比例：${input.aspectRatio}。\n当前账号已验证的视频生成方式：${input.availableVideoCapabilities ?? "图生视频（默认）"}。分镜 shotType 与对白设计应优先使用这些已就绪能力，不要假设未列出的引擎。\n\n${script}\n\n返回结构：{"logline":"一句话故事","narrationMode":"dialogue或narration","world":{"premise":"世界设定","rules":["连续性规则"],"tone":"视觉与叙事基调"},"relationships":[{"from":"角色","to":"角色","relation":"关系","development":"全剧变化"}],"characters":[{"name":"角色名","description":"稳定外形与身份描述","voiceDescription":"建议音色描述","episodeNumbers":[1],"forms":[{"name":"基础形象或具体形态","description":"服装发型年龄状态等","episodeNumbers":[1]}]}],"scenes":[{"name":"场景名","description":"空间与陈设","timeOfDay":"日/夜","interiorExterior":"内/外/内外","episodeNumbers":[1],"visualContinuity":"灯光天气色调和不可变化元素"}],"props":[{"name":"道具名","description":"外观与剧情用途","episodeNumbers":[1]}],"episodes":[{"episodeNumber":1,"title":"本集标题","summary":"本集摘要","scriptText":"忠实整理后的本集完整剧本","segments":[{"title":"片段标题","synopsis":"片段目标","sceneName":"必须匹配scenes中的名称","shots":[{"title":"镜头标题","prompt":"完整可执行导演指令","durationSeconds":5,"shotType":"visual/dialogue/voiceover/narration","dialogue":[{"speaker":"角色名或旁白","lineType":"dialogue/voiceover/narration","text":"台词","emotion":"情绪与语气","mouthOpen":true}]}]}]}]}` },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(dramaAnalysisTimeoutMs(input.episodes.length, script.length)),
  });
  if (!response.ok) throw new Error(`LLM_ANALYSIS_FAILED:${response.status}:${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM_ANALYSIS_EMPTY");
  return validateDramaAnalysis(extractJson(content), input.episodes.length);
}
