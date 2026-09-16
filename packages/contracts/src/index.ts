export type ProjectSourceType = "upload" | "ai_script" | "canvas";
export type ProjectStatus =
  | "draft"
  | "script_generating"
  | "script_generation_failed"
  | "script_analysis_failed"
  | "scripting"
  | "assets"
  | "asset_extraction"
  | "asset_review"
  | "storyboarding"
  | "production"
  | "rendering"
  | "rendered"
  | "completed"
  | "delivered"
  | "failed";

export type WorkflowCapability =
  | "image_generation"
  | "video_generation"
  | "character_image"
  | "scene_image"
  | "prop_image"
  | "storyboard_frame"
  | "multi_character_storyboard"
  | "last_frame_image"
  | "image_edit"
  | "text_to_video"
  | "image_to_video"
  | "multi_subject_video"
  | "first_last_frame_video"
  | "image_audio_video"
  | "native_audio_video"
  | "reference_video_character"
  | "voice_synthesis"
  | "lip_sync"
  | "ambient_audio"
  | "sfx_generation"
  | "bgm_generation";

export type ProductionCapability = WorkflowCapability | "segment_compose" | "episode_export";

export type GenerationJobStatus = "waiting" | "active" | "succeeded" | "failed" | "cancelled";

export interface CreateProjectCommand {
  title: string;
  sourceType: ProjectSourceType;
  synopsis?: string;
  stylePreset?: string;
  aspectRatio?: string;
  sourceText?: string;
}

export interface CreateGenerationJobCommand {
  projectId: string;
  entityType: "project" | "episode" | "segment" | "asset" | "shot";
  entityId: string;
  capability: WorkflowCapability;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export type ProductionRunStatus = "planned" | "blocked" | "queued" | "running" | "succeeded" | "failed";

export interface ProductionStep {
  id: string;
  scope: "segment" | "shot";
  entityId: string;
  capability: ProductionCapability;
  dependsOn: string[];
  purpose: string;
}

export interface SegmentProductionPlan {
  segmentId: string;
  status: "ready" | "blocked";
  steps: ProductionStep[];
  requiredCapabilities: ProductionCapability[];
  missingCapabilities: WorkflowCapability[];
  internalBlockers: string[];
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
