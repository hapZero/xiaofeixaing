import type { WorkflowCapability } from "./workflow-capabilities";

/** 概念锚点：文生图或上传，不直接出三视图 */
export function resolveCharacterConceptCapability(): WorkflowCapability {
  return "image_generation";
}

/** 标准图包：人物一致性，需要已有参考图 */
export function resolveCharacterPackCapability(hasReferenceAsset: boolean): WorkflowCapability | null {
  if (!hasReferenceAsset) return null;
  return "character_image";
}

export function characterFormConceptBlocker(hasConceptAsset: boolean): string | null {
  if (!hasConceptAsset) return "请先为当前形态文生图或上传概念图";
  return null;
}

export function characterFormPackBlocker(input: {
  hasConceptAsset: boolean;
  conceptLocked: boolean;
}): string | null {
  if (!input.hasConceptAsset) return "请先为当前形态准备概念图";
  if (!input.conceptLocked) return "请先保存并锁定当前形态的概念图";
  return null;
}

export function characterConceptJobCapabilities(): WorkflowCapability[] {
  return ["image_generation"];
}

export function characterPackJobCapabilities(): WorkflowCapability[] {
  return ["character_image"];
}

export function isCharacterVisualArchiveJob(entityType: string, capability: string) {
  if (entityType === "character" && capability === "image_generation") return true;
  if (entityType === "character" && capability === "character_image") return true;
  if (entityType === "character_form" && capability === "image_generation") return true;
  if (entityType === "character_form" && capability === "character_image") return true;
  return false;
}

export function pickBaseCharacterForm<T extends { name: string }>(forms: T[]): T | null {
  return forms.find((form) => form.name === "基础形象") ?? forms[0] ?? null;
}

export function isBaseCharacterForm(form: { name: string } | null | undefined) {
  return Boolean(form && (form.name === "基础形象" || form.name === "默认形象"));
}

export function buildFormVisualPrompt(input: {
  characterName: string;
  characterDescription: string;
  formName: string;
  formDescription?: string | null;
}) {
  const formNote = input.formDescription?.trim() || "沿用角色基础设定，准确呈现该形态的服装、发型、年龄与状态";
  return `角色：${input.characterName}。外观设定：${input.characterDescription}。当前形态：${input.formName}。形态设定：${formNote}。生成可用于短剧跨镜头一致性参考的角色标准图，保持脸部身份稳定。`;
}
