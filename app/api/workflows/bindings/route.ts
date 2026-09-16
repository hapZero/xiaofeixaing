import { and, eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../db";
import { workflowBindings, workflowTestRuns, workflowVersions } from "../../../../db/schema";
import { getBridgeWorkflow } from "../../../lib/server/comfyui";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { getWorkflowCapability, isWorkflowCapability } from "../../../lib/workflow-capabilities";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; [key: string]: unknown };
type WorkflowDocument = Record<string, WorkflowNode>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json"; collectAllImages?: boolean };
type SaveBindingBody = {
  capability?: string;
  name?: string;
  workflow?: WorkflowDocument;
  bridgeWorkflowId?: string;
  bridgeVersion?: string;
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
  if (output.collectAllImages) {
    if (!capability.outputs.some((item) => item.mediaType === output.mediaType)) return "输出媒体类型与能力不一致";
    const saveImageCount = Object.values(workflow).filter((node) => /saveimage/i.test(node.class_type ?? "")).length;
    if (!saveImageCount) return "工作流中没有 SaveImage 输出节点，无法归档标准图包";
    return null;
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
    sourceType: binding.sourceType,
    sourceWorkflowId: binding.sourceWorkflowId,
    sourceVersion: binding.sourceVersion,
    inputContract: JSON.parse(binding.inputContractJson) as InputContract,
    outputContract: JSON.parse(binding.outputContractJson) as OutputContract,
    enabled: binding.enabled,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function bindingExecutionChanged(
  existing: typeof workflowBindings.$inferSelect,
  next: {
    inputContract: InputContract;
    outputContract: OutputContract;
    sourceVersion: string | null;
    workflowStorageKey: string;
  },
): boolean {
  if (existing.sourceVersion !== next.sourceVersion) return true;
  if (existing.workflowStorageKey !== next.workflowStorageKey) return true;
  const previousInput = JSON.parse(existing.inputContractJson) as InputContract;
  const previousOutput = JSON.parse(existing.outputContractJson) as OutputContract;
  return JSON.stringify(previousInput) !== JSON.stringify(next.inputContract)
    || JSON.stringify(previousOutput) !== JSON.stringify(next.outputContract);
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
  let workflow = body.workflow;
  let bridgeName: string | null = null;
  let bridgeVersion: string | null = null;
  let bridgeNodes: unknown[] = [];
  if (body.bridgeWorkflowId) {
    try {
      const bridged = await getBridgeWorkflow(body.bridgeWorkflowId, body.bridgeVersion);
      workflow = bridged.api;
      bridgeName = bridged.workflow.name;
      bridgeVersion = bridged.version;
      bridgeNodes = bridged.workflow.nodes;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "COMFYUI_BRIDGE_WORKFLOW_READ_FAILED";
      return errorResponse(502, "COMFYUI_BRIDGE_WORKFLOW_READ_FAILED", "无法从桥接器读取该工作流", { reason });
    }
  }
  if (!isWorkflowDocument(workflow)) return errorResponse(400, "INVALID_WORKFLOW", "请选择桥接器已同步的 ComfyUI 工作流");
  if (!body.inputContract || !body.outputContract) return errorResponse(400, "INVALID_CONTRACT", "工作流输入和输出映射不完整");
  const definition = getWorkflowCapability(body.capability);
  if (!definition) return errorResponse(400, "INVALID_CAPABILITY", "工作流能力不存在");
  const contractError = validateContracts(workflow, definition, body.inputContract, body.outputContract);
  if (contractError) return errorResponse(400, "INVALID_CONTRACT", contractError);

  const db = getDb();
  const existingRows = await db.select().from(workflowBindings).where(and(eq(workflowBindings.ownerId, user.id), eq(workflowBindings.capability, body.capability))).limit(1);
  const existing = existingRows[0];
  const id = existing?.id ?? crypto.randomUUID();
  const storageKey = body.bridgeWorkflowId && bridgeVersion
    ? `workflows/${user.id}/versions/${body.bridgeWorkflowId}/${bridgeVersion}.json`
    : existing?.workflowStorageKey ?? `workflows/${user.id}/${body.capability}/${id}.json`;
  const now = new Date();
  await getMediaBucket().put(storageKey, JSON.stringify(workflow), { httpMetadata: { contentType: "application/json" } });
  if (body.bridgeWorkflowId && bridgeVersion) {
    await db.insert(workflowVersions).values({
      id: crypto.randomUUID(), ownerId: user.id, bridgeWorkflowId: body.bridgeWorkflowId, version: bridgeVersion,
      name: bridgeName ?? body.name ?? definition.name, workflowStorageKey: storageKey,
      nodeManifestJson: JSON.stringify(bridgeNodes), createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
  }
  const values = {
    name: body.name?.trim().slice(0, 80) || bridgeName?.slice(0, 80) || `${definition.name}工作流`,
    workflowStorageKey: storageKey,
    sourceType: body.bridgeWorkflowId ? "bridge" : "upload",
    sourceWorkflowId: body.bridgeWorkflowId ?? null,
    sourceVersion: bridgeVersion,
    inputContractJson: JSON.stringify(body.inputContract),
    outputContractJson: JSON.stringify(body.outputContract),
    enabled: body.enabled ?? true,
    updatedAt: now,
  };
  if (existing) {
    await db.update(workflowBindings).set(values).where(eq(workflowBindings.id, existing.id));
    if (bindingExecutionChanged(existing, {
      inputContract: body.inputContract,
      outputContract: body.outputContract,
      sourceVersion: bridgeVersion,
      workflowStorageKey: storageKey,
    })) {
      await db.insert(workflowTestRuns).values({
        id: crypto.randomUUID(), ownerId: user.id, workflowBindingId: existing.id, capability: body.capability,
        status: "invalidated", inputSummaryJson: "{}", errorMessage: "工作流执行版或字段映射已变更，需要重新测试",
        finishedAt: now, createdAt: now, updatedAt: now,
      });
    }
  } else {
    await db.insert(workflowBindings).values({ id, ownerId: user.id, capability: body.capability, ...values, createdAt: now });
  }
  const saved = (await db.select().from(workflowBindings).where(eq(workflowBindings.id, id)).limit(1))[0];
  return json({ binding: publicBinding(saved) }, { status: existing ? 200 : 201 });
}
