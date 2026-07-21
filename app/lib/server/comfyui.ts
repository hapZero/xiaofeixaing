import { env } from "cloudflare:workers";
import { getMediaBucket } from "../../../db";

type RuntimeEnv = { COMFYUI_BASE_URL?: string; COMFYUI_API_KEY?: string; COMFYUI_CLIENT_ID?: string };
type InputTarget = { nodeId: string; input: string };
type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; [key: string]: unknown }>;
export type WorkflowInputTarget = { nodeId: string; input: string };
export type WorkflowOutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string; outputKey?: string };
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

function config() {
  const runtime = env as unknown as RuntimeEnv;
  return {
    baseUrl: runtime.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? "",
    apiKey: runtime.COMFYUI_API_KEY ?? "",
    clientId: runtime.COMFYUI_CLIENT_ID ?? "xiaofeixiang",
  };
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
  if (/人物一致性/.test(name)) return { key: "character_image", label: "角色标准图" };
  if (/多图.*图片|文生图/.test(name)) return { key: "storyboard_frame", label: "分镜首帧" };
  if (/音频口型|音频参考/.test(name)) return { key: "native_audio_video", label: "原生有声视频" };
  if (/图生视频|首尾帧|多主体视频/.test(name)) return { key: "image_to_video", label: "图生视频" };
  if (/换角色/.test(name)) return { key: null, label: "视频角色替换（待增加能力）" };
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

export async function loadWorkflow(storageKey: string): Promise<WorkflowDocument> {
  const object = await getMediaBucket().get(storageKey);
  if (!object) throw new Error("WORKFLOW_FILE_NOT_FOUND");
  const workflow = await object.json<WorkflowDocument>();
  if (!workflow || typeof workflow !== "object") throw new Error("WORKFLOW_FILE_INVALID");
  return workflow;
}

export function applyWorkflowInputs(workflow: WorkflowDocument, contract: Record<string, InputTarget>, payload: Record<string, unknown>): WorkflowDocument {
  const copy = structuredClone(workflow);
  Object.entries(contract).forEach(([payloadKey, target]) => {
    if (!(payloadKey in payload)) return;
    const node = copy[target.nodeId];
    if (!node) throw new Error(`WORKFLOW_NODE_MISSING:${target.nodeId}`);
    node.inputs ??= {};
    node.inputs[target.input] = payload[payloadKey];
  });
  return copy;
}

export async function queueWorkflow(workflow: WorkflowDocument): Promise<{ promptId: string }> {
  const { baseUrl, apiKey, clientId } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`COMFYUI_QUEUE_FAILED:${response.status}`);
  const result = await response.json() as { prompt_id?: string };
  if (!result.prompt_id) throw new Error("COMFYUI_PROMPT_ID_MISSING");
  return { promptId: result.prompt_id };
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

export function getHistoryRecord(history: unknown, promptId: string): Record<string, unknown> | null {
  if (!history || typeof history !== "object") return null;
  const record = (history as Record<string, unknown>)[promptId];
  return record && typeof record === "object" ? record as Record<string, unknown> : null;
}

export function historyFailed(record: Record<string, unknown>): boolean {
  const status = record.status as { status_str?: string; completed?: boolean } | undefined;
  return status?.status_str === "error";
}

export function selectWorkflowOutput(record: Record<string, unknown>, contract: WorkflowOutputContract): ComfyOutputFile | null {
  const outputs = record.outputs as Record<string, Record<string, unknown>> | undefined;
  const nodeOutput = outputs?.[contract.nodeId];
  if (!nodeOutput) return null;
  const collections: Array<[string, unknown]> = [[contract.output, nodeOutput[contract.output]], ...Object.entries(nodeOutput).filter(([key]) => key !== contract.output)];
  for (const [outputKey, candidates] of collections) {
    if (!Array.isArray(candidates)) continue;
    const first = candidates[0] as Partial<ComfyOutputFile> | undefined;
    if (first?.filename) return { filename: first.filename, subfolder: first.subfolder, type: first.type, outputKey };
  }
  return null;
}

export async function downloadWorkflowOutput(file: ComfyOutputFile): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
  const response = await fetch(`${baseUrl}/view?${query}`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`COMFYUI_OUTPUT_DOWNLOAD_FAILED:${response.status}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}
