import { loadProductionRoutingRules } from "./production-routing-store";
import { parseShotProductionIntent, resolveShotProductionPlan, type ShotProductionIntent } from "../production-planner";

export async function resolveShotProductionPlanForOwner(ownerId: string, intent: ShotProductionIntent, configured: ReadonlySet<string>) {
  const rules = await loadProductionRoutingRules(ownerId);
  return resolveShotProductionPlan(intent, configured, rules);
}

export async function resolveShotPlanFromGenerationJson(ownerId: string, generationPlanJson: string, configured: ReadonlySet<string>, overrides: Partial<ShotProductionIntent> = {}) {
  return resolveShotProductionPlanForOwner(ownerId, parseShotProductionIntent(generationPlanJson, overrides), configured);
}
