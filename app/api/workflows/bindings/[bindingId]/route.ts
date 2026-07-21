import { and, eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../db";
import { workflowBindings } from "../../../../../db/schema";
import { errorResponse } from "../../../../lib/server/http";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ bindingId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { bindingId } = await context.params;
  const rows = await getDb().select().from(workflowBindings).where(and(eq(workflowBindings.id, bindingId), eq(workflowBindings.ownerId, user.id))).limit(1);
  const binding = rows[0];
  if (!binding) return errorResponse(404, "WORKFLOW_NOT_FOUND", "工作流绑定不存在");
  await getMediaBucket().delete(binding.workflowStorageKey);
  await getDb().delete(workflowBindings).where(eq(workflowBindings.id, bindingId));
  return new Response(null, { status: 204 });
}
