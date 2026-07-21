import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "xiaofeixiang.workflow-bridge";
let lastSyncedHash = "";
let originalGraphToPrompt = null;

function activeWorkflowName() {
  const active = app.workflowManager?.activeWorkflow;
  return active?.path || active?.name || app.graph?.extra?.workflowName || document.title.replace(/\s*[-|].*$/, "") || "Untitled Workflow";
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function syncResult(result) {
  const api = result?.output;
  if (!api || typeof api !== "object" || !Object.keys(api).length) return;
  const hash = await digest(api);
  if (hash === lastSyncedHash) return;
  const response = await fetch("/xiaofeixiang/bridge/workflows/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xiaofeixiang-ui": "1" },
    body: JSON.stringify({
      name: activeWorkflowName(),
      editor: result.workflow || app.graph?.serialize?.(),
      api,
      source: "comfyui-ui",
    }),
  });
  if (!response.ok) throw new Error(`Xiaofeixiang sync failed: ${response.status}`);
  lastSyncedHash = hash;
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
