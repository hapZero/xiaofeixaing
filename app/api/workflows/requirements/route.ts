import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { serviceConnections } from "../../../../db/schema";
import { loadMainlineReadiness } from "../../../lib/mainline-readiness";
import { bindingCapabilityKey, capabilitiesForSettingsSection, workflowCapabilities } from "../../../lib/workflow-capabilities";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { getWorkflowBindingReadiness } from "../../../lib/server/verified-workflows";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { verifiedBindings, bindings, latestTestStatusByBindingId } = await getWorkflowBindingReadiness(user.id);
  const services = await getDb().select().from(serviceConnections).where(eq(serviceConnections.ownerId, user.id));
  const mainline = await loadMainlineReadiness(user.id, verifiedBindings, services);
  const byCapability = new Map(bindings.map((binding) => [binding.capability, binding]));
  return json({
    mainline,
    capabilities: workflowCapabilities.map((item) => ({
      ...item,
      bindingKey: bindingCapabilityKey(item.key),
      configured: Boolean(byCapability.get(bindingCapabilityKey(item.key))?.enabled),
      verified: verifiedBindings.some((binding) => binding.capability === bindingCapabilityKey(item.key)),
      latestTestStatus: byCapability.get(bindingCapabilityKey(item.key)) ? latestTestStatusByBindingId.get(byCapability.get(bindingCapabilityKey(item.key))!.id) ?? null : null,
      bindingName: byCapability.get(bindingCapabilityKey(item.key))?.name ?? null,
      bindingId: byCapability.get(bindingCapabilityKey(item.key))?.id ?? null,
    })),
    sections: {
      image: capabilitiesForSettingsSection("image").map((item) => item.key),
      video: capabilitiesForSettingsSection("video").map((item) => item.key),
      audio: capabilitiesForSettingsSection("audio").map((item) => item.key),
    },
    legacyRedirect: "/api/settings/readiness",
  });
}
