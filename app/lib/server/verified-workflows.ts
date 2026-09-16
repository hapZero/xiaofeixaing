import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { workflowBindings, workflowTestRuns } from "../../../db/schema";
import { effectiveVerifiedCapabilities, resolveWorkflowBinding } from "../workflow-routing";

export { effectiveVerifiedCapabilities } from "../workflow-routing";

export async function getWorkflowBindingReadiness(ownerId: string) {
  const db = getDb();
  const bindings = await db.select().from(workflowBindings).where(and(
    eq(workflowBindings.ownerId, ownerId),
    eq(workflowBindings.enabled, true),
  ));
  if (!bindings.length) {
    return { bindings, verifiedBindings: [], latestTestStatusByBindingId: new Map<string, string>() };
  }

  const testRuns = await db.select({
    workflowBindingId: workflowTestRuns.workflowBindingId,
    status: workflowTestRuns.status,
  }).from(workflowTestRuns).where(and(
    eq(workflowTestRuns.ownerId, ownerId),
    inArray(workflowTestRuns.workflowBindingId, bindings.map((binding) => binding.id)),
  )).orderBy(desc(workflowTestRuns.createdAt));
  const latestTestStatusByBindingId = new Map<string, string>();
  testRuns.forEach((run) => {
    if (!latestTestStatusByBindingId.has(run.workflowBindingId)) latestTestStatusByBindingId.set(run.workflowBindingId, run.status);
  });
  const verifiedBindings = bindings.filter((binding) => latestTestStatusByBindingId.get(binding.id) === "succeeded");
  return { bindings, verifiedBindings, latestTestStatusByBindingId };
}

export async function getVerifiedWorkflowBinding(ownerId: string, capability: string, payload?: Record<string, unknown> | null) {
  const readiness = await getWorkflowBindingReadiness(ownerId);
  return resolveWorkflowBinding(readiness.verifiedBindings, capability, payload);
}
