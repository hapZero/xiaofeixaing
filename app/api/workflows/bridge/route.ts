import { getBridgeWorkflowPreparation, getComfyUiBridgeHealth, getBridgeWorkflow, listBridgeWorkflows, listStoredWorkflows, requestBridgeWorkflowPreparation } from "../../../lib/server/comfyui";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";

function normalizedWorkflowName(value: string) {
  return value.replace(/^workflows\//i, "").replace(/\.json$/i, "").trim().toLowerCase();
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const health = await getComfyUiBridgeHealth();
  if (!health.installed || !health.authorized) return json({ bridge: health, workflows: [] });
  try {
    const workflowId = new URL(request.url).searchParams.get("workflowId");
    const preparationId = new URL(request.url).searchParams.get("preparationId");
    const version = new URL(request.url).searchParams.get("version") ?? undefined;
    if (preparationId) {
      const preparation = await getBridgeWorkflowPreparation(preparationId);
      if (preparation.status === "succeeded" && preparation.workflowId) {
        return json({ bridge: health, preparation, ...(await getBridgeWorkflow(preparation.workflowId, preparation.version ?? undefined)) });
      }
      return json({ bridge: health, preparation });
    }
    if (workflowId) return json({ bridge: health, ...(await getBridgeWorkflow(workflowId, version)) });
    const [registered, storedNames] = await Promise.all([listBridgeWorkflows(), listStoredWorkflows()]);
    const stored = new Set(storedNames.map(normalizedWorkflowName));
    const available = registered
      .filter((workflow) => stored.has(normalizedWorkflowName(workflow.name)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const currentByName = new Map<string, (typeof available)[number]>();
    available.forEach((workflow) => {
      const key = normalizedWorkflowName(workflow.name);
      if (!currentByName.has(key)) currentByName.set(key, workflow);
    });
    const workflows = [...currentByName.values()];
    return json({ bridge: health, workflows, staleWorkflowCount: registered.length - workflows.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "COMFYUI_BRIDGE_FAILED";
    return errorResponse(502, "COMFYUI_BRIDGE_FAILED", "无法读取桥接器中的工作流", { reason });
  }
}


export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  try {
    const body = await request.json() as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) return errorResponse(400, "WORKFLOW_NAME_REQUIRED", "请选择一个 ComfyUI 工作流");
    return json({ preparation: await requestBridgeWorkflowPreparation(name) }, { status: 202 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "COMFYUI_BRIDGE_PREPARATION_FAILED";
    return errorResponse(502, "COMFYUI_BRIDGE_PREPARATION_FAILED", "无法通知 ComfyUI 准备工作流", { reason });
  }
}
