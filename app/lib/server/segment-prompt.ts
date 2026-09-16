type SegmentPromptSource = {
  title: string;
  synopsis: string;
  directorPrompt?: string | null;
  durationMs: number;
};

type ShotPromptSource = {
  id: string;
  prompt: string;
  durationMs: number;
};

type DialoguePromptSource = {
  shotId: string;
  lineType: string;
  text: string;
};

export type StoryboardFrameIdentity = {
  canonicalName: string;
  profileJson?: string | null;
  formName?: string | null;
  formDescription?: string | null;
};

function readCharacterAppearance(profileJson: string | null | undefined) {
  if (!profileJson) return "";
  try {
    const profile = JSON.parse(profileJson) as Record<string, unknown>;
    const parts = [
      typeof profile.appearance === "string" ? profile.appearance : "",
      typeof profile.look === "string" ? profile.look : "",
      typeof profile.visualDescription === "string" ? profile.visualDescription : "",
      typeof profile.description === "string" ? profile.description : "",
      typeof profile.summary === "string" ? profile.summary : "",
    ].map((part) => part.trim()).filter(Boolean);
    return parts[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Builds a cinematic first-frame prompt. Reference images lock identity;
 * the model must still generate a new story beat, not paste the refs.
 */
export function buildStoryboardFramePrompt(options: {
  shotPrompt: string;
  stylePreset?: string | null;
  aspectRatio?: string | null;
  identities?: StoryboardFrameIdentity[];
  sceneName?: string | null;
}) {
  const identityLines = (options.identities ?? [])
    .map((identity) => {
      const appearance = readCharacterAppearance(identity.profileJson);
      const formBits = [identity.formName, identity.formDescription].map((part) => part?.trim()).filter(Boolean).join("，");
      const detail = [appearance, formBits].filter(Boolean).join("；");
      return detail ? `${identity.canonicalName}：${detail}` : identity.canonicalName;
    })
    .filter(Boolean);

  return [
    options.shotPrompt.trim(),
    identityLines.length ? `出场角色外形：\n${identityLines.join("\n")}` : "",
    options.sceneName?.trim() ? `场景环境：${options.sceneName.trim()}` : "",
    options.stylePreset?.trim() ? `视觉风格：${options.stylePreset.trim()}` : "",
    options.aspectRatio?.trim() ? `画幅：${options.aspectRatio.trim()}` : "",
    "参考图只用于锁定人物面部身份、发型、服装与年龄，必须按上面的分镜描述新生成一张完整电影场景。角色要在场景里互动，光影统一。禁止把参考图原样拼贴、白底并排、三视图设定表；禁止姓名水印或任何文字标签。",
  ].filter(Boolean).join("\n\n");
}

/**
 * Builds the exact creator-visible instruction sent to a unified segment
 * generator. Keeping this in one place prevents the workbench preview from
 * drifting away from the payload that is actually submitted.
 */
export function buildSegmentPrompt(
  segment: SegmentPromptSource,
  segmentShots: ShotPromptSource[],
  lines: DialoguePromptSource[],
): string {
  const manualPrompt = segment.directorPrompt?.trim();
  if (manualPrompt) return manualPrompt;

  let cursorMs = 0;
  const shotInstructions = segmentShots.map((shot, index) => {
    const start = cursorMs;
    cursorMs += shot.durationMs;
    const shotLines = lines
      .filter((line) => line.shotId === shot.id)
      .map((line) => `${line.lineType === "dialogue" ? "角色对白" : line.lineType === "narration" ? "旁白" : "画外音"}：${line.text}`)
      .join("；");
    return `分镜 ${index + 1}（${(start / 1_000).toFixed(1)}-${(cursorMs / 1_000).toFixed(1)} 秒）\n${shot.prompt}${shotLines ? `\n${shotLines}` : "\n本镜头无对白，角色不要张嘴。"}`;
  });

  return [
    `片段：${segment.title}`,
    segment.synopsis ? `叙事目标：${segment.synopsis}` : "",
    `总时长约 ${(segment.durationMs / 1_000).toFixed(1)} 秒，共 ${segmentShots.length} 个连续分镜。`,
    "必须在一个连续视频中完整执行以下所有分镜，按时间顺序自然转场；保持角色身份、服装、场景空间、光线方向和声音连续，不要只生成第一个画面。",
    ...shotInstructions,
  ].filter(Boolean).join("\n\n");
}
