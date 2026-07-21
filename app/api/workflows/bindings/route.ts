import { and, eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../db";
import { workflowBindings } from "../../../../db/schema";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { getWorkflowCapability, isWorkflowCapability } from "../../../lib/workflow-capabilities";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; [key: string]: unknown };
type WorkflowDocument = Record<string, WorkflowNode>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
type SaveBindingBody = {
  capability?: string;
  name?: string;
  workflow?: WorkflowDocument;
  inputContract?: InputContract;
  outputContract?: OutputContract;
  enabled?: boolean;
};

function isWorkflowDocument(value: unknown): value is WorkflowDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nodes = Object.values(value as Record<string, unknown>);
  return nodes.length > 0 && nodes.every((node) => node && typeof node === "object" && typeof (node as WorkflowNode).class_type === "string");
}

function validateContracts(workflow: WorkflowDocument, capability: NonNullable<ReturnType<typeof getWorkflowCapability>>, inputs: InputContract, output: OutputContract): string | null {
  for (const definition of capability.inputs) {
    const target = inputs[definition.key];
    if (!target) {
      if (definition.required) return `必填输入“${definition.label}”尚未映射`;
      continue;
    }
    const node = workflow[target.nodeId];
    if (!node) return `输入“${definition.label}”引用的节点不存在`;
    if (!node.inputs || !(target.input in node.inputs)) return `节点 ${target.nodeId} 不包含输入 ${target.input}`;
    const currentValue = node.inputs[target.input];
    if (Array.isArray(currentValue) && currentValue.length === 2 && typeof currentValue[0] === "string") {
      return `输入“${definition.label}”指向了工作流内部连线，请绑定到对外暴露的参数节点`;
    }
  }
  if (!workflow[output.nodeId]) return "输出节点不存在";
  if (!capability.outputs.some((item) => item.mediaType === output.mediaType)) return "输出媒体类型与能力不一致";
  return null;
}

function publicBinding(binding: typeof workflowBindings.$inferSelect) {
  return {
    id: binding.id,
    capability: binding.capability,
    name: binding.name,
    inputContract: JSON.parse(binding.inputContractJson) as InputContract,
    outputContract: JSON.parse(binding.outputContractJson) as OutputContract,
    enabled: binding.enabled,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const bindings = await getDb().select().from(workflowBindings).where(eq(workflowBindings.ownerId, user.id));
  return json({ bindings: bindings.map(publicBinding) });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await readJson<SaveBindingBody>(request);
  if (!body?.capability || !isWorkflowCapability(body.capability)) return errorResponse(400, "INVALID_CAPABILITY", "请选择有效的工作流能力");
  if (!isWorkflowDocument(body.workflow)) return errorResponse(400, "INVALID_WORKFLOW", "请上传 ComfyUI API 格式的工作流 JSON");
  if (!body.inputContract || !body.outputContract) return errorResponse(400, "INVALID_CONTRACT", "工作流输入和输出映射不完整");
  const definition = getWorkflowCapability(body.capability);
  if (!definition) return errorResponse(400, "INVALID_CAPABILITY", "工作流能力不存在");
  const contractError = validateContracts(body.workflow, definition, body.inputContract, body.outputContract);
  if (contractError) return errorResponse(400, "INVALID_CONTRACT", contractError);

  const db = getDb();
  const existingRows = await db.select().from(workflowBindings).where(and(eq(workflowBindings.ownerId, user.id), eq(workflowBindings.capability, body.capability))).limit(1);
  const existing = existingRows[0];
  const id = existing?.id ?? crypto.randomUUID();
  const storageKey = existing?.workflowStorageKey ?? `workflows/${user.id}/${body.capability}/${id}.json`;
  const now = new Date();
  await getMediaBucket().put(storageKey, JSON.stringify(body.workflow), { httpMetadata: { contentType: "application/json" } });
  const values = {
    name: body.name?.trim().slice(0, 80) || `${definition.name}工作流`,
    workflowStorageKey: storageKey,
    inputContractJson: JSON.stringify(body.inputContract),
    outputContractJson: JSON.stringify(body.outputContract),
    enabled: body.enabled ?? true,
    updatedAt: now,
  };
  if (existing) {
    await db.update(workflowBindings).set(values).where(eq(workflowBindings.id, existing.id));
  } else {
    await db.insert(workflowBindings).values({ id, ownerId: user.id, capability: body.capability, ...values, createdAt: now });
  }
  const saved = (await db.select().from(workflowBindings).where(eq(workflowBindings.id, id)).limit(1))[0];
  return json({ binding: publicBinding(saved) }, { status: existing ? 200 : 201 });
}
