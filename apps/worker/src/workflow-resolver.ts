import type { CreateGenerationJobCommand } from "@xiaofeixiang/contracts";

export interface WorkflowResolver {
  resolve(command: CreateGenerationJobCommand): Promise<Record<string, unknown>>;
}

export class PayloadWorkflowResolver implements WorkflowResolver {
  async resolve(command: CreateGenerationJobCommand): Promise<Record<string, unknown>> {
    const workflow = command.payload.workflow;
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
      throw new Error(`WORKFLOW_NOT_BOUND:${command.capability}`);
    }
    return workflow as Record<string, unknown>;
  }
}
