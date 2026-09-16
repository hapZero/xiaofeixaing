export function readCharacterProfileDescription(profileJson: string, fallback = "请根据剧本中的人物身份形成稳定、可复用的外观") {
  if (!profileJson || profileJson === "{}") return fallback;
  try {
    const parsed = JSON.parse(profileJson) as { description?: unknown; visualImage?: unknown };
    if (typeof parsed.description === "string" && parsed.description.trim()) return parsed.description.trim();
    if (typeof parsed.visualImage === "string" && parsed.visualImage.trim()) return parsed.visualImage.trim();
  } catch {
    const trimmed = profileJson.trim();
    if (trimmed && !trimmed.startsWith("{")) return trimmed;
  }
  return fallback;
}

export function buildCharacterVisualPrompt(name: string, profileJson: string) {
  const description = readCharacterProfileDescription(profileJson);
  return `角色：${name}。外观设定：${description}。生成可用于短剧跨镜头一致性参考的角色标准图，保持脸部、体型与识别特征稳定一致。`;
}
