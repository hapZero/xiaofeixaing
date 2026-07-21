import { getComfyUiBridgeHealth, getBridgeWorkflow, listBridgeWorkflows } from "../../../lib/server/comfyui";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const health = await getComfyUiBridgeHealth();
  if (!health.installed || !health.authorized) return json({ bridge: health, workflows: [] });
  try {
    const workflowId = new URL(request.url).searchParams.get("workflowId");
    const version = new URL(request.url).searchParams.get("version") ?? undefined;
    if (workflowId) return json({ bridge: health, ...(await getBridgeWorkflow(workflowId, version)) });
    return json({ bridge: health, workflows: await listBridgeWorkflows() });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "COMFYUI_BRIDGE_FAILED";
    return errorResponse(502, "COMFYUI_BRIDGE_FAILED", "无法读取桥接器中的工作流", { reason });
  }
}
