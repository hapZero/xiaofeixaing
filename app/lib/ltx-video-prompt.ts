type WorkflowDocument = Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string }; [key: string]: unknown }>;

export function isLtxVideoWorkflow(workflow: WorkflowDocument): boolean {
  return Object.values(workflow).some((node) => /textgenerateltx2prompt|ltxvimgtovideoinplace|ltxvconditioning/i.test(String(node.class_type ?? "")));
}

export function isLtxAudioVideoWorkflow(workflow: WorkflowDocument): boolean {
  const classTypes = Object.values(workflow).map((node) => String(node.class_type ?? "").toLowerCase());
  return classTypes.some((classType) => /loadaudio/.test(classType))
    && classTypes.some((classType) => /ltxv|textgenerateltx2prompt|createvideo/.test(classType));
}

export function buildLtxImageToVideoPrompt(userPrompt: string): string {
  const motion = userPrompt.trim();
  if (!motion) return motion;
  return [
    "Keep the first frame composition, character identity, face, clothing, art style, and background exactly the same.",
    "",
    motion,
    "",
    "The same character performs this action with clear visible body motion, arm movement, and weight shift.",
    "Do not replace the character. Do not change the character design, age, gender, or art style.",
    "Do not change the scene, props, or background. No scene cut. No new characters.",
  ].join("\n");
}

export function buildLtxAudioVideoPrompt(userPrompt: string): string {
  const motion = userPrompt.trim() || "The character speaks naturally with accurate lip sync, subtle head movement, and small gestures that match the provided audio.";
  return [
    "Use the provided first frame image as the exact visual reference.",
    "Keep the same character identity, face, hairstyle, clothing, art style, and background from the first frame.",
    "",
    motion,
    "",
    "Match mouth movement and speech timing to the provided audio.",
    "Do not replace the character. Do not change the scene, props, or art style. No scene cut. No new characters.",
  ].join("\n");
}

export function buildLtxTextToVideoPrompt(userPrompt: string): string {
  const scene = userPrompt.trim();
  if (!scene) return scene;
  return [
    scene,
    "",
    "Cinematic short drama shot with stable camera, coherent motion, natural lighting, and no text or watermark.",
  ].join("\n");
}

function disableLtxPromptEnhance(workflow: WorkflowDocument): void {
  Object.values(workflow).forEach((node) => {
    const title = String(node._meta?.title ?? "");
    if (/enable prompt enhance/i.test(title) && /primitiveboolean/i.test(String(node.class_type ?? ""))) {
      node.inputs ??= {};
      node.inputs.value = false;
    }
  });
}

function enableLtxTextToVideoMode(workflow: WorkflowDocument): void {
  Object.values(workflow).forEach((node) => {
    const title = String(node._meta?.title ?? "");
    if (/switch to text to video/i.test(title) && /primitiveboolean/i.test(String(node.class_type ?? ""))) {
      node.inputs ??= {};
      node.inputs.value = true;
    }
  });
}

function applyLtxAspectRatio(workflow: WorkflowDocument, aspectRatio: unknown): void {
  if (typeof aspectRatio !== "string" || !aspectRatio.trim()) return;
  const sizes: Record<string, [number, number]> = {
    "9:16": [720, 1280],
    "16:9": [1280, 720],
    "1:1": [720, 720],
  };
  const size = sizes[aspectRatio.trim().toLowerCase()];
  if (!size) return;
  const [width, height] = size;
  const widthNode = workflow["320:312"];
  const heightNode = workflow["320:299"];
  if (widthNode?.inputs) widthNode.inputs.value = width;
  if (heightNode?.inputs) heightNode.inputs.value = height;
}

export function prepareLtxWorkflowExecution(
  workflow: WorkflowDocument,
  payload: Record<string, unknown>,
  capability?: string,
): { workflow: WorkflowDocument; payload: Record<string, unknown> } {
  if (!isLtxVideoWorkflow(workflow) && !isLtxAudioVideoWorkflow(workflow)) return { workflow, payload };
  const nextWorkflow = structuredClone(workflow);
  const nextPayload = { ...payload };
  disableLtxPromptEnhance(nextWorkflow);
  if (capability === "text_to_video") {
    enableLtxTextToVideoMode(nextWorkflow);
    applyLtxAspectRatio(nextWorkflow, nextPayload.aspectRatio);
    nextPayload.prompt = buildLtxTextToVideoPrompt(typeof nextPayload.prompt === "string" ? nextPayload.prompt : "");
  } else if (isLtxAudioVideoWorkflow(nextWorkflow)) {
    nextPayload.prompt = buildLtxAudioVideoPrompt(typeof nextPayload.prompt === "string" ? nextPayload.prompt : "");
  } else if (typeof nextPayload.prompt === "string" && nextPayload.prompt.trim()) {
    nextPayload.prompt = buildLtxImageToVideoPrompt(nextPayload.prompt);
  }
  if ("promptEnhance" in nextPayload) nextPayload.promptEnhance = false;
  return { workflow: nextWorkflow, payload: nextPayload };
}

/** @deprecated use prepareLtxWorkflowExecution */
export function prepareLtxVideoPayload(workflow: WorkflowDocument, payload: Record<string, unknown>): Record<string, unknown> {
  return prepareLtxWorkflowExecution(workflow, payload).payload;
}
