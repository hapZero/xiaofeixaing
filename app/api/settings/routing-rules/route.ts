import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { loadProductionRoutingRules, saveProductionRoutingRules } from "../../../lib/server/production-routing-store";
import type { ProductionRoutingRule } from "../../../lib/production-routing-rules";
import { isWorkflowCapability } from "../../../lib/workflow-capabilities";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  return json({ rules: await loadProductionRoutingRules(user.id) });
}

export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await request.json().catch(() => null) as { rules?: ProductionRoutingRule[] } | null;
  if (!body?.rules?.length) return errorResponse(400, "INVALID_RULES", "请提供路由规则列表");
  for (const rule of body.rules) {
    if (!rule.ruleKey || !rule.name || !isWorkflowCapability(rule.targetCapability)) {
      return errorResponse(400, "INVALID_RULE", "路由规则字段不完整或目标能力无效");
    }
  }
  return json({ rules: await saveProductionRoutingRules(user.id, body.rules) });
}
