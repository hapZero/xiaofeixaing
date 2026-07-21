import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { workflowBindings } from "../../../../db/schema";
import { comfyUiConfigured } from "../../../lib/server/comfyui";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { workflowCapabilities } from "../../../lib/workflow-capabilities";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const bindings = await getDb().select().from(workflowBindings).where(eq(workflowBindings.ownerId, user.id));
  const byCapability = new Map(bindings.map((binding) => [binding.capability, binding]));
  return json({
    comfyUiConfigured: comfyUiConfigured(),
    capabilities: workflowCapabilities.map((item) => ({
      ...item,
      configured: Boolean(byCapability.get(item.key)?.enabled),
      bindingName: byCapability.get(item.key)?.name ?? null,
      bindingId: byCapability.get(item.key)?.id ?? null,
    })),
  });
}
