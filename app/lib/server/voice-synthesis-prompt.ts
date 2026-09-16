type WorkflowDocument = Record<string, { class_type?: string; inputs?: Record<string, unknown>; [key: string]: unknown }>;
type InputContract = Record<string, { nodeId: string; input: string }>;

function isChatterboxVoiceNode(classType: string) {
  return /chatterbox/i.test(classType);
}

export function prepareVoiceSynthesisExecution(
  workflow: WorkflowDocument,
  contract: InputContract,
  payload: Record<string, unknown>,
): WorkflowDocument {
  const copy = structuredClone(workflow);
  const voiceTarget = contract.voiceReference;
  const hasVoiceReference = Boolean(voiceTarget && payload.voiceReference);
  if (!voiceTarget) return copy;

  if (!hasVoiceReference) {
    delete copy[voiceTarget.nodeId];
    for (const node of Object.values(copy)) {
      if (!isChatterboxVoiceNode(String(node.class_type ?? ""))) continue;
      if (node.inputs?.audio_prompt) delete node.inputs.audio_prompt;
    }
    return copy;
  }

  for (const node of Object.values(copy)) {
    if (!isChatterboxVoiceNode(String(node.class_type ?? ""))) continue;
    node.inputs ??= {};
    node.inputs.audio_prompt = [voiceTarget.nodeId, 0];
  }
  return copy;
}

export function buildVoiceSynthesisText(payload: Record<string, unknown>): string | undefined {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return undefined;
  const emotion = typeof payload.emotion === "string" ? payload.emotion.trim() : "";
  if (!emotion || emotion === "自然") return text;
  return `（${emotion}）${text}`;
}
