import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { productionRoutingRules } from "../../../db/schema";
import { defaultProductionRoutingRules, mergeRoutingRules, type ProductionRoutingRule } from "../production-routing-rules";

function parseRule(row: typeof productionRoutingRules.$inferSelect): ProductionRoutingRule {
  let condition: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.conditionJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) condition = parsed as Record<string, unknown>;
  } catch {
    condition = {};
  }
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    name: row.name,
    condition,
    targetCapability: row.targetCapability as ProductionRoutingRule["targetCapability"],
    priority: row.priority,
    enabled: row.enabled,
  };
}

export async function loadProductionRoutingRules(ownerId: string): Promise<ProductionRoutingRule[]> {
  try {
    const rows = await getDb().select().from(productionRoutingRules).where(eq(productionRoutingRules.ownerId, ownerId));
    return mergeRoutingRules(rows.map(parseRule));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|production_routing_rules/i.test(message)) {
      console.warn("[production-routing] table missing, falling back to defaults", message);
      return mergeRoutingRules([]);
    }
    throw error;
  }
}

export async function saveProductionRoutingRules(ownerId: string, rules: ProductionRoutingRule[]) {
  const db = getDb();
  const now = new Date();
  for (const rule of rules) {
    const values = {
      ownerId,
      ruleKey: rule.ruleKey,
      name: rule.name,
      conditionJson: JSON.stringify(rule.condition),
      targetCapability: rule.targetCapability,
      priority: rule.priority,
      enabled: rule.enabled,
      updatedAt: now,
    };
    const existing = (await db.select().from(productionRoutingRules).where(and(eq(productionRoutingRules.ownerId, ownerId), eq(productionRoutingRules.ruleKey, rule.ruleKey))).limit(1))[0];
    if (existing) await db.update(productionRoutingRules).set(values).where(eq(productionRoutingRules.id, existing.id));
    else await db.insert(productionRoutingRules).values({ id: crypto.randomUUID(), ...values, createdAt: now });
  }
  return loadProductionRoutingRules(ownerId);
}

export function seedDefaultRoutingRules(ownerId: string) {
  return defaultProductionRoutingRules.map((rule, index) => ({
    ...rule,
    id: `default:${ownerId}:${index}`,
  }));
}
