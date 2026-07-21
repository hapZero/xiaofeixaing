export type ExtractedScriptAssets = {
  characters: string[];
  scenes: string[];
  props: string[];
};

const reservedDialogueLabels = new Set([
  "人物", "场景", "地点", "时间", "道具", "旁白", "画外音", "内景", "外景", "镜头", "动作", "备注",
]);

function cleanName(value: string): string {
  return value
    .replace(/[（(].*?[）)]/g, "")
    .replace(/^[\s\d.、—-]+|[\s，,。；;：:]+$/g, "")
    .trim();
}

function unique(values: string[], maximum: number): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const value = cleanName(raw);
    if (!value || value.length > 40 || result.includes(value)) continue;
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

function captureLists(script: string, label: string): string[] {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[：:]\\s*([^\\n]+)`, "g");
  return [...script.matchAll(pattern)].flatMap((match) => match[1].split(/[、,，/与和]/));
}

export function extractScriptAssets(script: string): ExtractedScriptAssets {
  const characterCandidates = captureLists(script, "人物");
  for (const match of script.matchAll(/(?:^|\n)\s*([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z·]{1,11})\s*[：:]/g)) {
    if (!reservedDialogueLabels.has(match[1])) characterCandidates.push(match[1]);
  }

  const sceneCandidates = captureLists(script, "场景");
  for (const line of script.split(/\r?\n/)) {
    const normalized = line.trim();
    if (/^[^：:]{2,40}\s*[··•]\s*(?:日|夜|晨|昏|黄昏)\s*[··•]\s*(?:内|外)/.test(normalized)) {
      sceneCandidates.push(normalized.split(/[·•]/)[0]);
    }
    const heading = normalized.match(/^(?:第?\d+场|场景[一二三四五六七八九十\d]+)[：:\s-]+(.{2,40})$/);
    if (heading) sceneCandidates.push(heading[1]);
  }

  return {
    characters: unique(characterCandidates, 30),
    scenes: unique(sceneCandidates, 40),
    props: unique(captureLists(script, "道具"), 40),
  };
}
