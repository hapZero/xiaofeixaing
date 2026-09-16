type InputTarget = { nodeId: string; input: string };
type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; class_type?: string; [key: string]: unknown }>;

function isWorkflowLink(value: unknown) {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

function isUploadedImagePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.length) return false;
  // Asset UUIDs left in the payload must never be treated as ComfyUI filenames.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;
  return value.includes(".") || value.includes("/") || value.includes("\\");
}

function isUploadedImagePathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isUploadedImagePath);
}

const WORKFLOW_IMAGE_PAYLOAD_KEYS = [
  "firstFrame",
  "lastFrame",
  "sceneImage",
  "referenceImage",
  "characterImages",
  "propImages",
  "referenceImages",
] as const;

function collectedUploadedImages(payload: Record<string, unknown>) {
  return WORKFLOW_IMAGE_PAYLOAD_KEYS.flatMap((key) => {
    const value = payload[key];
    if (isUploadedImagePathList(value)) return value;
    if (isUploadedImagePath(value)) return [value];
    return [];
  });
}

function occupiedImageSlots(contract: Record<string, InputTarget>, excludeKey?: string) {
  return new Set(
    Object.entries(contract)
      .filter(([key]) => key !== excludeKey)
      .map(([, item]) => `${item.nodeId}::${item.input}`),
  );
}

function loadImageSlots(workflow: WorkflowDocument, occupied: ReadonlySet<string>, preferred?: InputTarget) {
  const slots = Object.entries(workflow)
    .filter(([, node]) => /loadimage/i.test(String(node.class_type ?? "")))
    .map(([nodeId, node]) => {
      const input = Object.keys(node.inputs ?? {}).find((name) => name === "image" || /image/i.test(name)) ?? "image";
      return { nodeId, input };
    })
    .filter(({ nodeId, input }) => !occupied.has(`${nodeId}::${input}`));

  if (!preferred) return slots;
  const preferredKey = `${preferred.nodeId}::${preferred.input}`;
  const preferredSlot = slots.find((slot) => `${slot.nodeId}::${slot.input}` === preferredKey) ?? preferred;
  return [preferredSlot, ...slots.filter((slot) => `${slot.nodeId}::${slot.input}` !== preferredKey)];
}

function applyImageListValue(
  workflow: WorkflowDocument,
  contract: Record<string, InputTarget>,
  payloadKey: string,
  images: string[],
  target: InputTarget,
) {
  const node = workflow[target.nodeId];
  const classType = String(node?.class_type ?? "");
  const occupied = occupiedImageSlots(contract, payloadKey);

  if (!node) return;

  if (!/loadimage/i.test(classType)) {
    node.inputs ??= {};
    node.inputs[target.input] = images;
    return;
  }

  if (!images.length) return;
  const slots = loadImageSlots(workflow, occupied, target);
  slots.slice(0, images.length).forEach((slot, index) => {
    const slotNode = workflow[slot.nodeId];
    if (!slotNode) return;
    slotNode.inputs ??= {};
    slotNode.inputs[slot.input] = images[index];
  });
  // Unused LoadImage slots in the same distribution pool keep baked workflow defaults
  // (demo robots / yellow masks / UI bars). Always overwrite them with a real upload.
  slots.slice(images.length).forEach((slot) => {
    const slotNode = workflow[slot.nodeId];
    if (!slotNode?.inputs) return;
    const current = slotNode.inputs[slot.input];
    if (typeof current === "string" && current.length > 0 && !images.includes(current)) {
      slotNode.inputs[slot.input] = images[0];
    }
  });
}


function isMissingMediaPayload(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

const OPTIONAL_REFERENCE_PLACEHOLDER_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

export async function ensureOptionalReferenceImage(
  payload: Record<string, unknown>,
  contract: Record<string, InputTarget>,
  upload: (file: File, prefix: string) => Promise<{ workflowValue: string }>,
  uploadPrefix: string,
) {
  if (!contract.referenceImage || !isMissingMediaPayload(payload.referenceImage)) return;
  const file = new File([OPTIONAL_REFERENCE_PLACEHOLDER_PNG], "xiaofeixiang-empty-reference.png", { type: "image/png" });
  const uploaded = await upload(file, uploadPrefix);
  payload.referenceImage = uploaded.workflowValue;
}

export function scrubMappedMediaPlaceholders(
  workflow: WorkflowDocument,
  contract: Record<string, InputTarget>,
  payload: Record<string, unknown>,
): WorkflowDocument {
  const copy = structuredClone(workflow);
  const uploadedImages = collectedUploadedImages(payload);
  const fallbackImage = (
    (isUploadedImagePath(payload.firstFrame) && payload.firstFrame)
    || (isUploadedImagePath(payload.sceneImage) && payload.sceneImage)
    || (isUploadedImagePathList(payload.characterImages) && payload.characterImages[0])
    || (isUploadedImagePathList(payload.referenceImages) && payload.referenceImages[0])
    || uploadedImages[0]
    || null
  );

  Object.entries(payload).forEach(([payloadKey, value]) => {
    const target = contract[payloadKey];
    if (!target) return;
    const node = copy[target.nodeId];
    if (!node?.inputs) return;
    if (isUploadedImagePathList(value) && /loadimage/i.test(String(node.class_type ?? ""))) {
      return;
    }
    if (typeof value === "string" && value.length > 0) {
      const currentValue = node.inputs[target.input];
      if (typeof currentValue === "string" && !/loadimage/i.test(String(node.class_type ?? ""))) node.inputs[target.input] = "";
    }
  });

  Object.entries(contract).forEach(([payloadKey, target]) => {
    if (!isMissingMediaPayload(payload[payloadKey])) return;
    const node = copy[target.nodeId];
    if (!node?.inputs || !/loadimage/i.test(String(node.class_type ?? ""))) return;
    // Missing optional image inputs must not keep baked demo defaults when other refs exist.
    if (fallbackImage) {
      node.inputs[target.input] = fallbackImage;
      return;
    }
    // 无任何参考图时保留工作流内 baked 默认值；空字符串会让 ComfyUI 读取整个 input 目录。
  });
  return copy;
}

export function assertWorkflowInputsApplied(
  workflow: WorkflowDocument,
  contract: Record<string, InputTarget>,
  payload: Record<string, unknown>,
): void {
  Object.entries(payload).forEach(([payloadKey, value]) => {
    const target = contract[payloadKey];
    if (!target) return;
    const node = workflow[target.nodeId];
    if (!node) throw new Error(`WORKFLOW_NODE_MISSING:${target.nodeId}`);
    if (isUploadedImagePathList(value)) {
      const slots = loadImageSlots(workflow, occupiedImageSlots(contract, payloadKey), target).slice(0, value.length);
      slots.forEach((slot, index) => {
        const applied = workflow[slot.nodeId]?.inputs?.[slot.input];
        if (applied !== value[index]) {
          throw new Error(`WORKFLOW_INPUT_NOT_APPLIED:${payloadKey}:${slot.nodeId}.${slot.input}:${String(applied)}`);
        }
      });
      return;
    }
    if (typeof value === "number") {
      const applied = node.inputs?.[target.input];
      if (Number(applied) !== value) {
        throw new Error(`WORKFLOW_INPUT_NOT_APPLIED:${payloadKey}:${target.nodeId}.${target.input}:${String(applied)}`);
      }
      return;
    }
    if (typeof value === "boolean") {
      const applied = node.inputs?.[target.input];
      if (Boolean(applied) !== value) {
        throw new Error(`WORKFLOW_INPUT_NOT_APPLIED:${payloadKey}:${target.nodeId}.${target.input}:${String(applied)}`);
      }
      return;
    }
    if (typeof value !== "string") return;
    const applied = node.inputs?.[target.input];
    if (applied !== value) {
      throw new Error(`WORKFLOW_INPUT_NOT_APPLIED:${payloadKey}:${target.nodeId}.${target.input}:${String(applied)}`);
    }
  });
}

export function applyWorkflowInputs(workflow: WorkflowDocument, contract: Record<string, InputTarget>, payload: Record<string, unknown>): WorkflowDocument {
  const copy = structuredClone(workflow);
  Object.entries(contract).forEach(([payloadKey, target]) => {
    if (!(payloadKey in payload)) return;
    const value = payload[payloadKey];
    const node = copy[target.nodeId];
    if (!node) throw new Error(`WORKFLOW_NODE_MISSING:${target.nodeId}`);
    node.inputs ??= {};
    const currentValue = node.inputs[target.input];
    if (isWorkflowLink(currentValue)) {
      throw new Error(`WORKFLOW_INPUT_TARGET_IS_LINK:${payloadKey}:${target.nodeId}.${target.input}`);
    }
    if (isUploadedImagePathList(value)) {
      applyImageListValue(copy, contract, payloadKey, value, target);
      return;
    }
    node.inputs[target.input] = value;
  });
  return copy;
}

export async function readComfyFailureDetail(response: Response) {
  const text = await response.text();
  if (!text) return "";
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string; type?: string };
      node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>;
    };
    const parts = [data.error?.message, data.error?.type].filter(Boolean) as string[];
    Object.entries(data.node_errors ?? {}).forEach(([nodeId, info]) => {
      info.errors?.forEach((item) => parts.push(`${nodeId}: ${item.message ?? item.details ?? "节点校验失败"}`));
    });
    return parts.join(" · ") || text;
  } catch {
    return text;
  }
}
