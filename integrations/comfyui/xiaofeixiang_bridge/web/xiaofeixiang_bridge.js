import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "xiaofeixiang.workflow-bridge";
let lastSyncedHash = "";
let originalGraphToPrompt = null;
let preparationPolling = false;

function activeWorkflowName() {
  const active = app.workflowManager?.activeWorkflow;
  const rawName = active?.path || active?.name || app.graph?.extra?.workflowName || document.title.replace(/\s*[-|].*$/, "") || "Untitled Workflow";
  const cleanName = String(rawName).replace(/^workflows\//i, "").replace(/^\*+/, "").trim();
  return cleanName.endsWith(".json") ? cleanName : `${cleanName}.json`;
}

async function digest(value) {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${serialized.length}`;
}

async function syncResult(result, forcedName = "", force = false) {
  const api = result?.output;
  if (!api || typeof api !== "object" || !Object.keys(api).length) return;
  const hash = await digest(api);
  const name = forcedName || activeWorkflowName();
  const syncKey = `${name}:${hash}`;
  if (!force && syncKey === lastSyncedHash) return;
  const response = await fetch("/xiaofeixiang/bridge/workflows/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xiaofeixiang-ui": "1" },
    body: JSON.stringify({
      name,
      editor: result.workflow || app.graph?.serialize?.(),
      api,
      source: "comfyui-ui",
    }),
  });
  if (!response.ok) throw new Error(`Xiaofeixiang sync failed: ${response.status}`);
  lastSyncedHash = syncKey;
  return response.json();
}

async function syncActiveWorkflow() {
  const graphToPrompt = originalGraphToPrompt || app.graphToPrompt?.bind(app);
  if (!graphToPrompt) return;
  const result = await graphToPrompt();
  await syncResult(result);
}

function syncAfterGraphLoad() {
  window.setTimeout(() => {
    void syncActiveWorkflow().catch((error) => console.warn("[Xiaofeixiang Bridge]", error));
  }, 250);
}

async function completePreparation(id, body) {
  const response = await fetch(`/xiaofeixiang/bridge/preparations/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-xiaofeixiang-ui": "1" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Preparation completion failed: ${response.status}`);
}

async function prepareRequestedWorkflow() {
  if (preparationPolling) return;
  preparationPolling = true;
  try {
    const response = await fetch("/xiaofeixiang/bridge/preparations/next", {
      headers: { "x-xiaofeixiang-ui": "1" },
      cache: "no-store",
    });
    if (response.status === 204) return;
    if (!response.ok) throw new Error(`Preparation polling failed: ${response.status}`);
    const { preparation } = await response.json();
    try {
      const storedPath = encodeURIComponent(`workflows/${preparation.name}`);
      const workflowResponse = await fetch(`/userdata/${storedPath}`, { cache: "no-store" });
      if (!workflowResponse.ok) throw new Error(`Workflow read failed: ${workflowResponse.status}`);
      const editor = await workflowResponse.json();
      await app.loadGraphData(editor, true, true, preparation.name.replace(/\.json$/i, ""), {
        deferWarnings: true,
        skipAssetScans: true,
        silentAssetErrors: true,
      });
      const result = await (originalGraphToPrompt || app.graphToPrompt.bind(app))();
      const synced = await syncResult(result, preparation.name, true);
      await completePreparation(preparation.id, {
        status: "succeeded",
        workflowId: synced?.workflow?.id,
        version: synced?.version,
      });
    } catch (error) {
      await completePreparation(preparation.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    console.warn("[Xiaofeixiang Bridge]", error);
  } finally {
    preparationPolling = false;
  }
}

app.registerExtension({
  name: EXTENSION_NAME,
  commands: [
    {
      id: "xiaofeixiang.sync-workflow",
      label: "同步当前工作流到小飞象",
      function: syncActiveWorkflow,
    },
  ],
  afterConfigureGraph() {
    syncAfterGraphLoad();
  },
  async setup() {
    if (app.graphToPrompt.__xiaofeixiangWrapped) return;
    originalGraphToPrompt = app.graphToPrompt.bind(app);
    const wrapped = async (...args) => {
      const result = await originalGraphToPrompt(...args);
      void syncResult(result).catch((error) => console.warn("[Xiaofeixiang Bridge]", error));
      return result;
    };
    wrapped.__xiaofeixiangWrapped = true;
    app.graphToPrompt = wrapped;
  },
});

document.documentElement.dataset.xiaofeixiangBridgeVersion = "0.2.0";
if (!window.__xiaofeixiangPreparationTimer) {
  window.__xiaofeixiangPreparationTimer = window.setInterval(() => void prepareRequestedWorkflow(), 1200);
  void prepareRequestedWorkflow();
}
