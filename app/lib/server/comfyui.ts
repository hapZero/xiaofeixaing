import { env } from "cloudflare:workers";
import { getMediaBucket } from "../../../db";
import { readComfyFailureDetail } from "../workflow-input-apply";
import { saveImageNodeIds, selectAllWorkflowImageOutputs } from "../workflow-output-select";
export { saveImageNodeIds, selectAllWorkflowImageOutputs } from "../workflow-output-select";

type RuntimeEnv = { COMFYUI_BASE_URL?: string; COMFYUI_API_KEY?: string; COMFYUI_CLIENT_ID?: string; COMFYUI_BRIDGE_TOKEN?: string };
type InputTarget = { nodeId: string; input: string };
type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; [key: string]: unknown }>;
export type WorkflowInputTarget = { nodeId: string; input: string };
export type WorkflowOutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json"; collectAllImages?: boolean };
export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string; outputKey?: string; nodeId?: string };
export type StoredWorkflowFormat = "api" | "editor" | "unknown";
export type StoredWorkflowAnalysis = {
  name: string;
  format: StoredWorkflowFormat;
  nodeCount: number;
  nodeTypes: string[];
  suggestedCapability: string | null;
  suggestedLabel: string;
  outputNodeTypes: string[];
};
export type BridgeNode = { id: string; classType: string; title: string; weight: number };
export type BridgeWorkflowSummary = {
  id: string;
  name: string;
  latestVersion: string;
  updatedAt: number;
  nodeCount: number;
  nodes: BridgeNode[];
  suggestedCapabilities: string[];
};
export type BridgeExecutionEvent = {
  sequence: number;
  type: string;
  promptId: string | null;
  occurredAt: number;
  data: Record<string, unknown>;
  snapshot?: BridgeExecutionSnapshot;
};
export type BridgeExecutionSnapshot = {
  promptId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  currentNodeId: string | null;
  currentNodeTitle: string | null;
  nodeValue: number | null;
  nodeMax: number | null;
  overallProgress: number;
  completedNodeIds: string[];
  cachedNodeIds: string[];
  totalNodes: number;
  completedNodes: number;
  updatedAt: number;
  error?: Record<string, unknown>;
};
export type BridgeWorkflowPreparation = {
  id: string;
  name: string;
  status: "queued" | "preparing" | "succeeded" | "failed";
  createdAt: number;
  updatedAt: number;
  workflowId: string | null;
  version: string | null;
  error: string | null;
};

export function bridgeExecutionFailureMessage(snapshot?: BridgeExecutionSnapshot | null): string | null {
  if (!snapshot || snapshot.status !== "failed") return null;
  const error = snapshot.error;
  if (error && typeof error === "object") {
    const nodeId = "node_id" in error ? String(error.node_id ?? "") : "";
    const nodeType = "node_type" in error ? String(error.node_type ?? "") : "";
    const detail = "exception_message" in error ? String(error.exception_message ?? "").trim() : "";
    const label = [nodeId, nodeType].filter(Boolean).join(" · ");
    return label && detail ? `${label}：${detail}` : detail || "ComfyUI 工作流执行失败";
  }
  return "ComfyUI 工作流执行失败";
}

function config() {
  const runtime = env as unknown as RuntimeEnv;
  return {
    baseUrl: runtime.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? "",
    apiKey: runtime.COMFYUI_API_KEY ?? "",
    clientId: runtime.COMFYUI_CLIENT_ID ?? "xiaofeixiang",
    bridgeToken: runtime.COMFYUI_BRIDGE_TOKEN ?? "",
  };
}

function bridgeHeaders(token: string): HeadersInit {
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

function headers(apiKey: string): HeadersInit {
  return apiKey ? { "content-type": "application/json", authorization: `Bearer ${apiKey}` } : { "content-type": "application/json" };
}

function authHeaders(apiKey: string): HeadersInit {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export function comfyUiConfigured(): boolean {
  return Boolean(config().baseUrl);
}

export function getComfyUiServerUrl(): string {
  return config().baseUrl;
}

function suggestStoredCapability(name: string): { key: string | null; label: string } {
  if (/人物一致性/.test(name)) return { key: "character_image", label: "人物一致性生成器" };
  if (/多主体视频/.test(name)) return { key: "multi_subject_video", label: "多人镜头视频" };
  if (/首尾帧/.test(name)) return { key: "first_last_frame_video", label: "首尾帧视频" };
  if (/音频口型|口型/.test(name)) return { key: "lip_sync", label: "口型同步" };
  if (/音频参考/.test(name)) return { key: "native_audio_video", label: "原生有声视频" };
  if (/图生视频/.test(name)) return { key: "image_to_video", label: "图生视频" };
  if (/多图.*图片|文生图/.test(name)) return { key: null, label: "图片生成（需按用途确认）" };
  if (/换角色/.test(name)) return { key: null, label: "视频角色替换（辅助工具）" };
  return { key: null, label: "待人工确认" };
}

function analyzeStoredWorkflow(name: string, document: unknown): StoredWorkflowAnalysis {
  const suggested = suggestStoredCapability(name);
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const record = document as Record<string, unknown>;
    const apiNodes = Object.values(record);
    if (apiNodes.length && apiNodes.every((node) => node && typeof node === "object" && typeof (node as { class_type?: unknown }).class_type === "string")) {
      const nodeTypes = apiNodes.map((node) => (node as { class_type: string }).class_type);
      return { name, format: "api", nodeCount: nodeTypes.length, nodeTypes: [...new Set(nodeTypes)], suggestedCapability: suggested.key, suggestedLabel: suggested.label, outputNodeTypes: [...new Set(nodeTypes.filter((type) => /save|preview|combine/i.test(type)))] };
    }
    if (Array.isArray(record.nodes)) {
      const nodeTypes = record.nodes.map((node) => node && typeof node === "object" ? String((node as { type?: unknown }).type ?? "") : "").filter(Boolean);
      return { name, format: "editor", nodeCount: nodeTypes.length, nodeTypes: [...new Set(nodeTypes)], suggestedCapability: suggested.key, suggestedLabel: suggested.label, outputNodeTypes: [...new Set(nodeTypes.filter((type) => /save|preview|combine/i.test(type)))] };
    }
  }
  return { name, format: "unknown", nodeCount: 0, nodeTypes: [], suggestedCapability: suggested.key, suggestedLabel: suggested.label, outputNodeTypes: [] };
}

function validStoredWorkflowName(name: string): boolean {
  return Boolean(name) && name.endsWith(".json") && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

export async function listStoredWorkflows(): Promise<string[]> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}/userdata?dir=workflows&recurse=true`, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`COMFYUI_WORKFLOW_LIST_FAILED:${response.status}`);
  const result = await response.json() as unknown;
  if (!Array.isArray(result)) throw new Error("COMFYUI_WORKFLOW_LIST_INVALID");
  return result.filter((name): name is string => typeof name === "string" && validStoredWorkflowName(name));
}

export async function getStoredWorkflow(name: string): Promise<{ workflow: unknown; analysis: StoredWorkflowAnalysis }> {
  if (!validStoredWorkflowName(name)) throw new Error("COMFYUI_WORKFLOW_NAME_INVALID");
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const storedPath = encodeURIComponent(`workflows/${name}`);
  const response = await fetch(`${baseUrl}/userdata/${storedPath}`, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`COMFYUI_WORKFLOW_READ_FAILED:${response.status}`);
  const workflow = await response.json() as unknown;
  return { workflow, analysis: analyzeStoredWorkflow(name, workflow) };
}

export async function inspectStoredWorkflows(): Promise<StoredWorkflowAnalysis[]> {
  const names = await listStoredWorkflows();
  const inspected = await Promise.allSettled(names.map((name) => getStoredWorkflow(name)));
  return inspected.map((result, index) => result.status === "fulfilled" ? result.value.analysis : { name: names[index], format: "unknown" as const, nodeCount: 0, nodeTypes: [], suggestedCapability: null, suggestedLabel: "读取失败", outputNodeTypes: [] });
}

export async function testComfyUiConnection(): Promise<{ connected: boolean; deviceCount: number; system: string | null }> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) return { connected: false, deviceCount: 0, system: null };
  const response = await fetch(`${baseUrl}/system_stats`, { headers: headers(apiKey), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`COMFYUI_CONNECTION_FAILED:${response.status}`);
  const data = await response.json() as { system?: { os?: string }; devices?: unknown[] };
  return { connected: true, deviceCount: data.devices?.length ?? 0, system: data.system?.os ?? null };
}

export async function getComfyUiBridgeHealth(): Promise<{ installed: boolean; version: string | null; authorized: boolean }> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl) return { installed: false, version: null, authorized: false };
  try {
    const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/health`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { installed: false, version: null, authorized: false };
    const data = await response.json() as { installed?: boolean; version?: string };
    if (!data.installed) return { installed: false, version: null, authorized: false };
    if (!bridgeToken) return { installed: true, version: data.version ?? null, authorized: false };
    const workflowResponse = await fetch(`${baseUrl}/xiaofeixiang/bridge/workflows`, { headers: bridgeHeaders(bridgeToken), signal: AbortSignal.timeout(5_000) });
    return { installed: true, version: data.version ?? null, authorized: workflowResponse.ok };
  } catch {
    return { installed: false, version: null, authorized: false };
  }
}

export async function listBridgeWorkflows(): Promise<BridgeWorkflowSummary[]> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  if (!bridgeToken) throw new Error("COMFYUI_BRIDGE_TOKEN_MISSING");
  const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/workflows`, { headers: bridgeHeaders(bridgeToken), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`COMFYUI_BRIDGE_WORKFLOWS_FAILED:${response.status}`);
  const data = await response.json() as { workflows?: BridgeWorkflowSummary[] };
  return Array.isArray(data.workflows) ? data.workflows : [];
}

export async function getBridgeWorkflow(workflowId: string, version?: string): Promise<{ workflow: BridgeWorkflowSummary; version: string; api: WorkflowDocument }> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  if (!bridgeToken) throw new Error("COMFYUI_BRIDGE_TOKEN_MISSING");
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/workflows/${encodeURIComponent(workflowId)}${query}`, { headers: bridgeHeaders(bridgeToken), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`COMFYUI_BRIDGE_WORKFLOW_READ_FAILED:${response.status}`);
  return response.json() as Promise<{ workflow: BridgeWorkflowSummary; version: string; api: WorkflowDocument }>;
}

export async function requestBridgeWorkflowPreparation(name: string): Promise<BridgeWorkflowPreparation> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  if (!bridgeToken) throw new Error("COMFYUI_BRIDGE_TOKEN_MISSING");
  const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/preparations`, {
    method: "POST",
    headers: bridgeHeaders(bridgeToken),
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`COMFYUI_BRIDGE_PREPARATION_FAILED:${response.status}`);
  const data = await response.json() as { preparation: BridgeWorkflowPreparation };
  return data.preparation;
}

export async function getBridgeWorkflowPreparation(preparationId: string): Promise<BridgeWorkflowPreparation> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  if (!bridgeToken) throw new Error("COMFYUI_BRIDGE_TOKEN_MISSING");
  const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/preparations/${encodeURIComponent(preparationId)}`, {
    headers: bridgeHeaders(bridgeToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`COMFYUI_BRIDGE_PREPARATION_STATUS_FAILED:${response.status}`);
  const data = await response.json() as { preparation: BridgeWorkflowPreparation };
  return data.preparation;
}

async function registerBridgeExecution(promptId: string, workflow: WorkflowDocument, metadata: Record<string, unknown>): Promise<boolean> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl || !bridgeToken) return false;
  try {
    const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/executions/register`, {
      method: "POST",
      headers: bridgeHeaders(bridgeToken),
      body: JSON.stringify({ promptId, workflow, metadata }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getBridgeExecution(promptId: string, since = 0): Promise<{ execution: BridgeExecutionSnapshot; events: BridgeExecutionEvent[] } | null> {
  const { baseUrl, bridgeToken } = config();
  if (!baseUrl || !bridgeToken) return null;
  try {
    const response = await fetch(`${baseUrl}/xiaofeixiang/bridge/executions/${encodeURIComponent(promptId)}?since=${Math.max(0, since)}`, { headers: bridgeHeaders(bridgeToken), signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`COMFYUI_BRIDGE_EXECUTION_FAILED:${response.status}`);
    return response.json() as Promise<{ execution: BridgeExecutionSnapshot; events: BridgeExecutionEvent[] }>;
  } catch {
    return null;
  }
}

export async function loadWorkflow(storageKey: string): Promise<WorkflowDocument> {
  const object = await getMediaBucket().get(storageKey);
  if (!object) throw new Error("WORKFLOW_FILE_NOT_FOUND");
  const workflow = await object.json<WorkflowDocument>();
  if (!workflow || typeof workflow !== "object") throw new Error("WORKFLOW_FILE_INVALID");
  return workflow;
}

export { applyWorkflowInputs, assertWorkflowInputsApplied, ensureOptionalReferenceImage, scrubMappedMediaPlaceholders } from "../workflow-input-apply";
export {
  buildLtxAudioVideoPrompt,
  buildLtxImageToVideoPrompt,
  isLtxAudioVideoWorkflow,
  isLtxVideoWorkflow,
  prepareLtxVideoPayload,
  prepareLtxWorkflowExecution,
} from "../ltx-video-prompt";

export async function queueWorkflow(workflow: WorkflowDocument, metadata: Record<string, unknown> = {}): Promise<{ promptId: string; bridgeRegistered: boolean }> {
  const { baseUrl, apiKey, clientId } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await readComfyFailureDetail(response);
    throw new Error(`COMFYUI_QUEUE_FAILED:${response.status}${detail ? `:${detail}` : ""}`);
  }
  const result = await response.json() as { prompt_id?: string };
  if (!result.prompt_id) throw new Error("COMFYUI_PROMPT_ID_MISSING");
  const bridgeRegistered = await registerBridgeExecution(result.prompt_id, workflow, metadata);
  return { promptId: result.prompt_id, bridgeRegistered };
}

export async function uploadWorkflowInput(file: File, prefix = "xiaofeixiang"): Promise<{ name: string; subfolder: string; type: string; workflowValue: string }> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "input.bin";
  const uploadName = `${prefix}-${crypto.randomUUID()}-${safeName}`;
  const form = new FormData();
  form.append("image", new File([await file.arrayBuffer()], uploadName, { type: file.type || "application/octet-stream" }));
  form.append("type", "input");
  form.append("overwrite", "false");
  const response = await fetch(`${baseUrl}/upload/image`, { method: "POST", headers: authHeaders(apiKey), body: form, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`COMFYUI_INPUT_UPLOAD_FAILED:${response.status}`);
  const result = await response.json() as { name?: string; subfolder?: string; type?: string };
  if (!result.name) throw new Error("COMFYUI_INPUT_UPLOAD_INVALID");
  const subfolder = result.subfolder ?? "";
  return { name: result.name, subfolder, type: result.type ?? "input", workflowValue: subfolder ? `${subfolder}/${result.name}` : result.name };
}

export async function getWorkflowHistory(promptId: string): Promise<unknown> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`COMFYUI_HISTORY_FAILED:${response.status}`);
  return response.json();
}

export async function workflowQueuePresence(promptId: string): Promise<boolean | null> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  try {
    const response = await fetch(`${baseUrl}/queue`, { headers: headers(apiKey), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json() as { queue_running?: unknown[]; queue_pending?: unknown[] };
    const entries = [...(Array.isArray(data.queue_running) ? data.queue_running : []), ...(Array.isArray(data.queue_pending) ? data.queue_pending : [])];
    return entries.some((entry) => Array.isArray(entry) && entry.some((value) => value === promptId));
  } catch {
    return null;
  }
}

export function getHistoryRecord(history: unknown, promptId: string): Record<string, unknown> | null {
  if (!history || typeof history !== "object") return null;
  const record = (history as Record<string, unknown>)[promptId];
  return record && typeof record === "object" ? record as Record<string, unknown> : null;
}

export function historyFailed(record: Record<string, unknown>): boolean {
  const status = record.status as { status_str?: string; completed?: boolean } | undefined;
  return status?.status_str === "error";
}

export function historyExecutionError(record: Record<string, unknown>): string | null {
  const messages = (record.status as { messages?: unknown[] } | undefined)?.messages;
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!Array.isArray(entry) || entry[0] !== "execution_error") continue;
    const detail = entry[1];
    if (!detail || typeof detail !== "object") continue;
    const nodeId = "node_id" in detail ? String((detail as { node_id?: unknown }).node_id ?? "") : "";
    const nodeType = "node_type" in detail ? String((detail as { node_type?: unknown }).node_type ?? "") : "";
    const message = "exception_message" in detail ? String((detail as { exception_message?: unknown }).exception_message ?? "").trim() : "";
    if (!message) continue;
    const label = [nodeId, nodeType].filter(Boolean).join(" · ");
    return label ? `${label}：${message}` : message;
  }
  return null;
}

export function selectWorkflowOutput(record: Record<string, unknown>, contract: WorkflowOutputContract): ComfyOutputFile | null {
  return selectWorkflowOutputs(record, contract)[0] ?? null;
}

export function selectWorkflowOutputs(record: Record<string, unknown>, contract: WorkflowOutputContract): ComfyOutputFile[] {
  const outputs = record.outputs as Record<string, Record<string, unknown>> | undefined;
  const nodeOutput = outputs?.[contract.nodeId];
  if (!nodeOutput) return [];
  const collections: Array<[string, unknown]> = [[contract.output, nodeOutput[contract.output]], ...Object.entries(nodeOutput).filter(([key]) => key !== contract.output)];
  for (const [outputKey, candidates] of collections) {
    if (!Array.isArray(candidates)) continue;
    const files = candidates.flatMap((candidate) => {
      const file = candidate as Partial<ComfyOutputFile> | undefined;
      return file?.filename ? [{ filename: file.filename, subfolder: file.subfolder, type: file.type, outputKey, nodeId: contract.nodeId }] : [];
    });
    if (files.length) return files;
  }
  return [];
}

export function resolveWorkflowOutputs(
  record: Record<string, unknown>,
  contract: WorkflowOutputContract,
  options?: { capability?: string; workflow?: WorkflowDocument | null },
) {
  const collectAll = contract.collectAllImages || options?.capability === "character_image";
  if (collectAll && contract.mediaType === "image") {
    const files = selectAllWorkflowImageOutputs(record, options?.workflow);
    if (files.length) return files;
  }
  return selectWorkflowOutputs(record, contract);
}

export function selectWorkflowInlineOutput(record: Record<string, unknown>, contract: WorkflowOutputContract): unknown {
  const outputs = record.outputs as Record<string, Record<string, unknown>> | undefined;
  const nodeOutput = outputs?.[contract.nodeId];
  if (!nodeOutput) return undefined;
  if (contract.output in nodeOutput) return nodeOutput[contract.output];
  return Object.values(nodeOutput)[0];
}

export async function downloadWorkflowOutput(file: ComfyOutputFile): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
  const response = await fetch(`${baseUrl}/view?${query}`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`COMFYUI_OUTPUT_DOWNLOAD_FAILED:${response.status}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export function inspectMp4DurationSeconds(bytes: ArrayBuffer): number | null {
  const data = new Uint8Array(bytes);
  const marker = [0x6d, 0x76, 0x68, 0x64]; // mvhd
  let index = -1;
  for (let cursor = 0; cursor <= data.length - marker.length; cursor += 1) {
    if (marker.every((value, offset) => data[cursor + offset] === value)) {
      index = cursor;
      break;
    }
  }
  if (index < 0 || index + 32 > data.length) return null;
  const view = new DataView(bytes);
  const version = view.getUint8(index + 4);
  const timescaleOffset = index + (version === 1 ? 24 : 16);
  const durationOffset = timescaleOffset + 4;
  if (durationOffset + (version === 1 ? 8 : 4) > data.length) return null;
  const timescale = view.getUint32(timescaleOffset);
  if (!timescale) return null;
  const duration = version === 1 ? Number(view.getBigUint64(durationOffset)) : view.getUint32(durationOffset);
  return duration / timescale;
}

export function inspectAudioDurationSeconds(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes);
  const header = new TextDecoder().decode(new Uint8Array(bytes, 0, 12));
  if (header.startsWith("RIFF") && header.includes("WAVE") && bytes.byteLength >= 44) {
    const byteRate = view.getUint32(28, true);
    const dataSize = view.getUint32(40, true);
    if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  }
  if (header.startsWith("ID3") || (view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0)) {
    return inspectMp4DurationSeconds(bytes);
  }
  return null;
}
