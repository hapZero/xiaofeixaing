export type OutlineCharacter = {
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

export type ParsedDramaOutline = {
  logline: string;
  genre: string;
  coreHooks: string[];
  targetAudience: string;
  premise: string;
  tone: string;
  characters: OutlineCharacter[];
  relationships: Array<{ from: string; to: string; relation: string; development: string }>;
};

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function cleanOutlineText(value: unknown, maximum: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : fallback;
}

function mapOutlineCharacter(source: Record<string, unknown>): OutlineCharacter | null {
  const name = cleanOutlineText(source.name, 40);
  if (!name) return null;
  const description = cleanOutlineText(source.description, 1000);
  return {
    name,
    roleType: cleanOutlineText(source.roleType, 40, "角色"),
    visualImage: cleanOutlineText(source.visualImage, 500, description || name),
    coreTags: cleanOutlineText(source.coreTags, 200),
    background: cleanOutlineText(source.background, 1000, description),
    growthHistory: cleanOutlineText(source.growthHistory, 1000),
    personality: cleanOutlineText(source.personality, 500),
    relationships: cleanOutlineText(source.relationships, 1000),
    growthArc: cleanOutlineText(source.growthArc, 1000),
  };
}

export function parseOutlineCharactersFromWorld(worldJson: string | null | undefined): OutlineCharacter[] {
  const world = parseJsonRecord(worldJson);
  const outlineCharacters = Array.isArray(world.outlineCharacters) ? world.outlineCharacters : [];
  const mappedOutline = outlineCharacters.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const character = mapOutlineCharacter(item as Record<string, unknown>);
    return character ? [character] : [];
  });
  if (mappedOutline.length) return mappedOutline;

  const analysisCharacters = Array.isArray(world.characters) ? world.characters : [];
  return analysisCharacters.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const character = mapOutlineCharacter(item as Record<string, unknown>);
    return character ? [character] : [];
  });
}

export function parseDramaOutlineFromStoryBible(storyBible: {
  logline: string | null;
  worldJson: string;
  relationshipsJson: string;
} | null | undefined): ParsedDramaOutline {
  const world = parseJsonRecord(storyBible?.worldJson);
  let relationships: ParsedDramaOutline["relationships"] = [];
  try {
    const parsed = JSON.parse(storyBible?.relationshipsJson || "[]") as unknown;
    if (Array.isArray(parsed)) {
      relationships = parsed.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const from = cleanOutlineText(item.from, 40);
        const to = cleanOutlineText(item.to, 40);
        return from && to ? [{ from, to, relation: cleanOutlineText(item.relation, 200), development: cleanOutlineText(item.development, 1000) }] : [];
      });
    }
  } catch {
    relationships = [];
  }
  return {
    logline: cleanOutlineText(storyBible?.logline, 500),
    genre: cleanOutlineText(world.genre, 120),
    coreHooks: Array.isArray(world.coreHooks) ? world.coreHooks.map((item) => cleanOutlineText(item, 80)).filter(Boolean).slice(0, 12) : [],
    targetAudience: cleanOutlineText(world.targetAudience, 120),
    premise: cleanOutlineText(world.premise, 1200),
    tone: cleanOutlineText(world.tone, 500),
    characters: parseOutlineCharactersFromWorld(storyBible?.worldJson),
    relationships,
  };
}

export function isStoryOutlineReady(storyBible: {
  logline: string | null;
  worldJson: string;
} | null | undefined): boolean {
  const outline = parseDramaOutlineFromStoryBible(storyBible ?? null);
  if (!outline.logline || !outline.genre || !outline.targetAudience || outline.coreHooks.length < 2) return false;
  if (outline.characters.length < 1) return false;
  return outline.characters.every((character) => Boolean(character.name && character.roleType && character.visualImage));
}

export function formatOutlineForPrompt(outline: ParsedDramaOutline): string {
  const characters = outline.characters.map((character) => (
    `- ${character.name}（${character.roleType}）：${character.visualImage}；标签：${character.coreTags || "无"}；背景：${character.background || "无"}`
  )).join("\n");
  return [
    `一句话故事：${outline.logline}`,
    `故事类型：${outline.genre}`,
    `目标受众：${outline.targetAudience}`,
    `核心梗：${outline.coreHooks.join("、")}`,
    outline.premise ? `世界观：${outline.premise}` : "",
    outline.tone ? `叙事基调：${outline.tone}` : "",
    characters ? `人物小传：\n${characters}` : "",
  ].filter(Boolean).join("\n");
}

const GENERIC_CHARACTER_PATTERNS = [
  /^旁白$/,
  /^画外音$/,
  /^OS$/,
  /^VO$/,
  /弟子/,
  /门徒/,
  /修士/,
  /路人/,
  /行人/,
  /群众/,
  /众人/,
  /人群/,
  /观众/,
  /守卫/,
  /侍从/,
  /侍卫/,
  /官兵/,
  /士兵/,
  /衙役/,
  /太监/,
  /宫女/,
  /丫鬟/,
  /仆人/,
  /随从/,
  /小贩/,
  /商人/,
  /老板/,
  /掌柜/,
  /伙计/,
  /乞丐/,
  /食客/,
  /刺客/,
  /杀手/,
  /黑衣人/,
  /白衣人/,
  /蒙面/,
  /神秘人/,
  /老者/,
  /少年/,
  /少女/,
  /孩童/,
  /壮汉/,
  /男子/,
  /女子/,
  /汉子/,
  /姑娘/,
  /青年/,
  /中年/,
  /老人/,
  /几人/,
  /数名/,
  /若干/,
  /众/,
];

const SCRIPT_STRUCTURE_LABELS = new Set([
  "场景", "出场人物", "时间", "地点", "环境", "镜头", "动作", "对白",
  "音效", "转场", "备注", "说明", "人物", "气氛", "道具", "服装",
  "标题", "摘要", "画", "切", "闪回", "接", "续", "尾声", "序幕",
]);

function isScriptStructureLabel(name: string) {
  const token = normalizeCharacterToken(name);
  if (!token) return true;
  if (SCRIPT_STRUCTURE_LABELS.has(token)) return true;
  if (/^场景/.test(token)) return true;
  if (/^第[0-9一二三四五六七八九十百]+[集场幕]/u.test(token)) return true;
  return false;
}

function isScriptStructureLine(line: string) {
  return /^(场景|出场人物|时间|地点|环境|镜头|动作|音效|转场|备注|说明|道具|服装)([：:（(]|$)/u.test(line);
}

function normalizeCharacterToken(value: string) {
  return value.trim().replace(/^[\*_\s]+|[\*_\s]+$/g, "").replace(/[：:].*$/, "");
}

export function extractScriptCharacterTokens(scriptText: string) {
  const tokens = new Set<string>();
  for (const rawLine of scriptText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const presence = line.match(/出场人物[：:]\s*(.+)/u);
    if (presence) {
      for (const part of presence[1].split(/[、，,/|]+/u)) {
        const name = normalizeCharacterToken(part);
        if (name && !isScriptStructureLabel(name)) tokens.add(name);
      }
      continue;
    }
    if (isScriptStructureLine(line)) continue;
    for (const pattern of [/^\*\*([^*]+)\*\*\s*[（(:：]/u, /^([^（(:：【\[]+?)\s*[（(:：]/u]) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const name = normalizeCharacterToken(match[1]);
        if (name && !isScriptStructureLabel(name)) tokens.add(name);
      }
    }
  }
  return [...tokens];
}

function isGenericCharacterToken(name: string) {
  return GENERIC_CHARACTER_PATTERNS.some((pattern) => pattern.test(name));
}

function resolveHonorificAlias(name: string, rosterNames: string[]) {
  const match = name.match(/^(.{1,2})(师兄|师姐|师弟|师妹|长老|宗主|掌门|前辈|小姐|公子|姑娘|师父|老师|大叔|阿姨)$/);
  if (!match) return null;
  const matches = rosterNames.filter((item) => item.startsWith(match[1]));
  return matches.length === 1 ? matches[0] : null;
}

export function findUnknownScriptCharacters(scriptText: string, rosterNames: string[]) {
  const roster = rosterNames.map((name) => name.trim()).filter(Boolean);
  if (!roster.length) return [];
  return extractScriptCharacterTokens(scriptText).filter((token) => {
    if (isGenericCharacterToken(token)) return false;
    if (roster.includes(token)) return false;
    if (resolveHonorificAlias(token, roster)) return false;
    return true;
  });
}

export function validateScriptCharacterRoster(scriptText: string, rosterNames: string[]) {
  const unknown = findUnknownScriptCharacters(scriptText, rosterNames);
  if (unknown.length) throw new Error(`LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:${unknown.join("、")}`);
}

export function formatOutlineForEpisodeGeneration(outline: ParsedDramaOutline) {
  const roster = outline.characters.map((character) => character.name).filter(Boolean);
  return [
    formatOutlineForPrompt(outline),
    "",
    "【人物白名单 · 硬性约束】",
    `分集剧本中的出场人物和对白说话人，只能使用以下正式姓名：${roster.join("、")}`,
    "禁止发明未出现在人物小传中的新角色名，禁止把已有角色改名（例如把小传里的赵无极写成赵铁柱、王师兄等其他名字）。",
    "允许使用无具体姓名的群众描述：数名弟子、路人、守卫、旁白、画外音。",
    "对白中如需称呼，可使用与正式姓名唯一对应的同姓简称（如仅有一位姓赵的角色时，可称“赵师兄”指赵无极），但出场人物行仍应写正式姓名。",
  ].join("\n");
}
