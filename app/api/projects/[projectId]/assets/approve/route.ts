import { errorResponse, json } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";
import { lockReadyProjectVisualAssets } from "../../../../../lib/server/visual-asset-approval-batch";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await getRequestUser(_request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const result = await lockReadyProjectVisualAssets(projectId);
  return json(result);
}
