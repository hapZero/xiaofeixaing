export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const normalized = (fenced ?? content).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(normalized);
  } catch {
    // Reasoning-capable OpenAI-compatible models can prepend analysis even
    // when response_format=json_object is requested.
  }
  const starts = [...normalized].flatMap((character, index) => character === "{" || character === "[" ? [index] : []);
  const candidates: Array<{ value: unknown; start: number; end: number }> = [];
  for (const start of starts) {
    const opening = normalized[start];
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === opening) depth += 1;
      if (character === closing) depth -= 1;
      if (depth !== 0) continue;
      try {
        candidates.push({ value: JSON.parse(normalized.slice(start, index + 1)), start, end: index + 1 });
      } catch {
        // Keep scanning because reasoning text can contain schema fragments.
      }
      break;
    }
  }
  candidates.sort((left, right) => right.end - left.end || (right.end - right.start) - (left.end - left.start));
  if (candidates[0]) return candidates[0].value;
  throw new Error("LLM_JSON_INVALID");
}
