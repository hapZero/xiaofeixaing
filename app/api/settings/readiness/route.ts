import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { serviceConnections } from "../../../../db/schema";
import { loadMainlineReadiness } from "../../../lib/mainline-readiness";
import { bindingCapabilityKey, capabilitiesForSettingsSection, workflowCapabilities } from "../../../lib/workflow-capabilities";
import { resolveWorkflowBinding } from "../../../lib/workflow-routing";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { getWorkflowBindingReadiness } from "../../../lib/server/verified-workflows";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { verifiedBindings, bindings, latestTestStatusByBindingId } = await getWorkflowBindingReadiness(user.id);
  const services = await getDb().select().from(serviceConnections).where(eq(serviceConnections.ownerId, user.id));
  const mainline = await loadMainlineReadiness(user.id, verifiedBindings, services);
  const verifiedBindingIds = new Set(verifiedBindings.map((binding) => binding.id));
  return json({
    mainline,
    capabilities: workflowCapabilities.map((item) => {
      const binding = resolveWorkflowBinding(bindings, item.key);
      return {
        ...item,
        bindingKey: bindingCapabilityKey(item.key),
        configured: Boolean(binding?.enabled),
        verified: binding ? verifiedBindingIds.has(binding.id) : false,
        latestTestStatus: binding ? latestTestStatusByBindingId.get(binding.id) ?? null : null,
        bindingName: binding?.name ?? null,
        bindingId: binding?.id ?? null,
      };
    }),
    sections: {
      image: capabilitiesForSettingsSection("image").map((item) => item.key),
      video: capabilitiesForSettingsSection("video").map((item) => item.key),
      audio: capabilitiesForSettingsSection("audio").map((item) => item.key),
    },
  });
}
