import { env } from "cloudflare:workers";
import { getMediaBucket } from "../../../db";

type RuntimeEnv = { COMFYUI_BASE_URL?: string; COMFYUI_API_KEY?: string; COMFYUI_CLIENT_ID?: string };
type InputTarget = { nodeId: string; input: string };
type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; [key: string]: unknown }>;

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
