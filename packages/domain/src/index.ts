import type { ProjectSourceType, ProjectStatus, WorkflowCapability } from "@xiaofeixiang/contracts";

export * from "./production.js";

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  sourceType: ProjectSourceType;
  status: ProjectStatus;
  stylePreset: string;
  aspectRatio: string;
  synopsis: string | null;
  sourceText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowBinding {
  id: string;
  ownerId: string;
  capability: WorkflowCapability;
  name: string;
  workflowStorageKey: string;
  enabled: boolean;
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertProjectTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new DomainError("INVALID_PROJECT_TITLE", "项目名称不能为空");
  if (normalized.length > 80) throw new DomainError("INVALID_PROJECT_TITLE", "项目名称不能超过 80 个字符");
  return normalized;
}
