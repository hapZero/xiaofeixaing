export type StoryboardDraft = {
  title: string;
  prompt: string;
  durationMs: number;
  sceneName: string | null;
};

function isSceneHeading(line: string): boolean {
  return /^[^：:]{2,40}\s*[··•]\s*(?:日|夜|晨|昏|黄昏)\s*[··•]\s*(?:内|外)/.test(line)
    || /^(?:第?\d+场|场景[一二三四五六七八九十\d]+)[：:\s-]+/.test(line);
}

function sceneFromHeading(line: string): string {
  if (line.includes("·") || line.includes("•")) return line.split(/[·•]/)[0].trim();
  return line.replace(/^(?:第?\d+场|场景[一二三四五六七八九十\d]+)[：:\s-]+/, "").trim();
}

export function createStoryboardDrafts(script: string): StoryboardDraft[] {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const drafts: StoryboardDraft[] = [];
  let sceneName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const prompt = buffer.join("\n");
    const firstContent = buffer.find((line) => !/^(人物|场景|道具)[：:]/.test(line)) ?? buffer[0];
    drafts.push({
      title: firstContent.replace(/[：:].*$/, "").slice(0, 22) || `分镜 ${drafts.length + 1}`,
      prompt,
      durationMs: Math.min(12_000, Math.max(4_000, 3_000 + prompt.length * 55)),
      sceneName,
    });
    buffer = [];
  };

  for (const line of lines) {
    if (isSceneHeading(line)) {
      flush();
      sceneName = sceneFromHeading(line);
      buffer.push(line);
      continue;
    }
    buffer.push(line);
    if (buffer.length >= 3 || buffer.join("").length >= 150) flush();
  }
  flush();
  return drafts.slice(0, 60);
}
