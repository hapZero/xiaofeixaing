export type ProjectSourceType = "upload" | "ai_script" | "canvas";
export type ProjectStatus = "draft" | "scripting" | "assets" | "storyboarding" | "rendering" | "completed" | "failed";

export type WorkflowCapability =
  | "script_to_assets"
  | "character_image"
  | "scene_image"
  | "storyboard_frame"
  | "image_to_video"
  | "voice_synthesis"
  | "lip_sync"
  | "native_audio_video"
  | "ambient_audio"
  | "episode_compose";

export type GenerationJobStatus = "waiting" | "active" | "succeeded" | "failed" | "cancelled";

export interface CreateProjectCommand {
  title: string;
  sourceType: ProjectSourceType;
  synopsis?: string;
  stylePreset?: string;
  aspectRatio?: string;
}

export interface CreateGenerationJobCommand {
  projectId: string;
  entityType: "project" | "episode" | "asset" | "shot";
  entityId: string;
  capability: WorkflowCapability;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface GenerationJobEvent {
  jobId: string;
  projectId: string;
  status: GenerationJobStatus;
  progress: number;
  message?: string;
  occurredAt: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}
