import type { CreateGenerationJobCommand, WorkflowCapability } from "@xiaofeixiang/contracts";
import { IsIn, IsNotEmpty, IsObject, IsString, IsUUID, Matches, MaxLength } from "class-validator";

const capabilities: WorkflowCapability[] = [
  "script_to_assets", "character_image", "scene_image", "storyboard_frame", "image_to_video",
  "voice_synthesis", "lip_sync", "native_audio_video", "ambient_audio", "episode_compose",
];

export class CreateGenerationJobDto implements CreateGenerationJobCommand {
  @IsUUID() projectId!: string;
  @IsIn(["project", "episode", "asset", "shot"]) entityType!: CreateGenerationJobCommand["entityType"];
  @IsUUID() entityId!: string;
  @IsIn(capabilities) capability!: WorkflowCapability;
  @IsObject() payload!: Record<string, unknown>;
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "idempotencyKey 只能包含字母、数字、下划线和短横线" })
  idempotencyKey!: string;
}
