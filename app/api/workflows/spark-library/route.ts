import { getStoredWorkflow, inspectStoredWorkflows } from "../../../lib/server/comfyui";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const name = new URL(request.url).searchParams.get("name");
  try {
    if (name) {
      const result = await getStoredWorkflow(name);
      return json({ analysis: result.analysis, workflow: result.analysis.format === "api" ? result.workflow : null });
    }
    const workflows = await inspectStoredWorkflows();
    return json({ workflows });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "COMFYUI_WORKFLOW_DISCOVERY_FAILED";
    return errorResponse(502, "COMFYUI_WORKFLOW_DISCOVERY_FAILED", "无法读取 Spark 上的工作流", { reason });
  }
}
