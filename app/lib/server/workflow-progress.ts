import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { workflowExecutionEvents } from "../../../db/schema";
import { getBridgeExecution, type BridgeExecutionSnapshot } from "./comfyui";

export type PublicExecutionProgress = {
  source: "bridge";
  overall: number;
  stage: string;
  currentNodeId: string | null;
  currentNodeTitle: string | null;
  nodeValue: number | null;
  nodeMax: number | null;
  completedNodes: number;
  totalNodes: number;
  cachedNodes: number;
  lastSequence: number;
};

function progressStage(snapshot: BridgeExecutionSnapshot): string {
  if (snapshot.status === "failed") return "ComfyUI 执行失败";
  if (snapshot.status === "succeeded") return "ComfyUI 生成完成";
  if (snapshot.currentNodeTitle) return `正在执行：${snapshot.currentNodeTitle}`;
  return snapshot.status === "running" ? "ComfyUI 正在执行" : "已进入 ComfyUI 队列";
}

export async function syncExecutionProgress(input: {
  ownerId: string;
  executionType: "test_run" | "generation_job";
  executionId: string;
  promptId: string;
}): Promise<{ snapshot: BridgeExecutionSnapshot; progress: PublicExecutionProgress } | null> {
  const db = getDb();
  const latest = (await db.select({ sequence: workflowExecutionEvents.sequence })
    .from(workflowExecutionEvents)
    .where(and(eq(workflowExecutionEvents.executionType, input.executionType), eq(workflowExecutionEvents.executionId, input.executionId)))
    .orderBy(desc(workflowExecutionEvents.sequence))
    .limit(1))[0];
  const bridge = await getBridgeExecution(input.promptId, latest?.sequence ?? 0);
  if (!bridge) return null;
  for (const event of bridge.events) {
    const snapshot = event.snapshot ?? bridge.execution;
    const data = event.data ?? {};
    await db.insert(workflowExecutionEvents).values({
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      executionType: input.executionType,
      executionId: input.executionId,
      promptId: input.promptId,
      sequence: event.sequence,
      eventType: event.type,
      nodeId: typeof data.node === "string" || typeof data.node === "number" ? String(data.node) : snapshot.currentNodeId,
      nodeTitle: snapshot.currentNodeTitle,
      nodeValue: typeof snapshot.nodeValue === "number" ? Math.round(snapshot.nodeValue) : null,
      nodeMax: typeof snapshot.nodeMax === "number" ? Math.round(snapshot.nodeMax) : null,
      overallProgress: snapshot.overallProgress,
      payloadJson: JSON.stringify(event),
      createdAt: new Date(event.occurredAt),
    }).onConflictDoNothing();
  }
  const lastSequence = Math.max(latest?.sequence ?? 0, ...bridge.events.map((event) => event.sequence), 0);
  const execution = bridge.execution;
  return {
    snapshot: execution,
    progress: {
      source: "bridge",
      overall: Math.min(95, 10 + Math.round(execution.overallProgress * 0.85)),
      stage: progressStage(execution),
      currentNodeId: execution.currentNodeId,
      currentNodeTitle: execution.currentNodeTitle,
      nodeValue: execution.nodeValue,
      nodeMax: execution.nodeMax,
      completedNodes: execution.completedNodes,
      totalNodes: execution.totalNodes,
      cachedNodes: execution.cachedNodeIds.length,
      lastSequence,
    },
  };
}
