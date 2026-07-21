import { env } from "cloudflare:workers";
import { getMediaBucket } from "../../../db";

type RuntimeEnv = { COMFYUI_BASE_URL?: string; COMFYUI_API_KEY?: string; COMFYUI_CLIENT_ID?: string };
type InputTarget = { nodeId: string; input: string };
type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; [key: string]: unknown }>;
export type WorkflowInputTarget = { nodeId: string; input: string };
export type WorkflowOutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string };

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

export function comfyUiConfigured(): boolean {
  return Boolean(config().baseUrl);
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
  const candidates = nodeOutput?.[contract.output];
  if (!Array.isArray(candidates)) return null;
  const first = candidates[0] as Partial<ComfyOutputFile> | undefined;
  return first?.filename ? { filename: first.filename, subfolder: first.subfolder, type: first.type } : null;
}

export async function downloadWorkflowOutput(file: ComfyOutputFile): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) throw new Error("COMFYUI_NOT_CONFIGURED");
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
  const response = await fetch(`${baseUrl}/view?${query}`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`COMFYUI_OUTPUT_DOWNLOAD_FAILED:${response.status}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}
