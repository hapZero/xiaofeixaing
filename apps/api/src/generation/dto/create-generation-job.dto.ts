import type { CreateGenerationJobCommand, WorkflowCapability } from "@xiaofeixiang/contracts";
import { IsIn, IsNotEmpty, IsObject, IsString, IsUUID, Matches, MaxLength } from "class-validator";

const capabilities: WorkflowCapability[] = [
  "image_generation", "video_generation",
  "character_image", "scene_image", "storyboard_frame", "image_to_video", "multi_subject_video", "first_last_frame_video",
  "voice_synthesis", "lip_sync", "native_audio_video", "ambient_audio",
];

export class CreateGenerationJobDto implements CreateGenerationJobCommand {
  @IsUUID() projectId!: string;
  @IsIn(["project", "episode", "segment", "asset", "shot"]) entityType!: CreateGenerationJobCommand["entityType"];
  @IsUUID() entityId!: string;
  @IsIn(capabilities) capability!: WorkflowCapability;
  @IsObject() payload!: Record<string, unknown>;
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "idempotencyKey 只能包含字母、数字、下划线和短横线" })
  idempotencyKey!: string;
}
