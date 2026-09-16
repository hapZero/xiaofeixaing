import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const projectSourceType = pgEnum("project_source_type", ["upload", "ai_script", "canvas"]);
export const projectStatus = pgEnum("project_status", ["draft", "script_generating", "script_generation_failed", "script_analysis_failed", "scripting", "assets", "asset_extraction", "asset_review", "storyboarding", "production", "rendering", "rendered", "completed", "delivered", "failed"]);
export const generationStatus = pgEnum("generation_status", ["waiting", "active", "succeeded", "failed", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_phone_uidx").on(table.phone)]);

export const serviceConnections = pgTable("service_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model"),
  secretCiphertext: text("secret_ciphertext"),
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("service_connections_owner_kind_uidx").on(table.ownerId, table.kind),
  index("service_connections_owner_idx").on(table.ownerId),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: projectSourceType("source_type").notNull(),
  status: projectStatus("status").notNull().default("draft"),
  stylePreset: text("style_preset").notNull().default("写实电影风格"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  synopsis: text("synopsis"),
  sourceText: text("source_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const storyBibles = pgTable("story_bibles", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceRevision: integer("source_revision").notNull().default(1),
  logline: text("logline"),
  world: jsonb("world").notNull().default({}),
  timeline: jsonb("timeline").notNull().default([]),
  relationships: jsonb("relationships").notNull().default([]),
  styleGuide: jsonb("style_guide").notNull().default({}),
  narrationMode: text("narration_mode").notNull().default("dialogue"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("story_bibles_project_uidx").on(table.projectId)]);

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  scriptText: text("script_text"),
  status: text("status").notNull().default("draft"),
  videoAssetId: uuid("video_asset_id"),
  subtitleAssetId: uuid("subtitle_asset_id"),
  currentVersionNumber: integer("current_version_number").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("episodes_project_number_uidx").on(table.projectId, table.episodeNumber),
  index("episodes_project_idx").on(table.projectId),
]);

export const episodeVersions = pgTable("episode_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  resultAssetId: uuid("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  subtitleAssetId: uuid("subtitle_asset_id").references(() => assets.id, { onDelete: "set null" }),
  durationMs: integer("duration_ms").notNull().default(0),
  inputs: jsonb("inputs").notNull().default({}),
  status: text("status").notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("episode_versions_episode_version_uidx").on(table.episodeId, table.versionNumber),
  index("episode_versions_episode_idx").on(table.episodeId),
]);

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  assetType: text("asset_type").notNull(),
  sourceRevision: integer("source_revision"),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  storageKey: text("storage_key"),
  thumbnailUrl: text("thumbnail_url"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("assets_project_type_idx").on(table.projectId, table.assetType)]);

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  canonicalName: text("canonical_name").notNull(),
  profile: jsonb("profile").notNull().default({}),
  voiceAssetId: uuid("voice_asset_id").references(() => assets.id, { onDelete: "set null" }),
  voiceDescription: text("voice_description"),
  voiceLocked: boolean("voice_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("characters_project_idx").on(table.projectId)]);

export const characterForms = pgTable("character_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  episodeScope: jsonb("episode_scope").notNull().default([]),
  inheritVoice: boolean("inherit_voice").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("character_forms_character_idx").on(table.characterId)]);

export const characterFormReferences = pgTable("character_form_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterFormId: uuid("character_form_id").notNull().references(() => characterForms.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  referenceType: text("reference_type").notNull().default("reference"),
  referenceOrder: integer("reference_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("character_form_references_form_idx").on(table.characterFormId),
  uniqueIndex("character_form_references_form_order_uidx").on(table.characterFormId, table.referenceOrder),
]);

export const audioPresets = pgTable("audio_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  presetType: text("preset_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  config: jsonb("config").notNull().default({}),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audio_presets_project_type_idx").on(table.projectId, table.presetType)]);

export const storyScenes = pgTable("story_scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  episodeScope: jsonb("episode_scope").notNull().default([]),
  timeOfDay: text("time_of_day"),
  interiorExterior: text("interior_exterior"),
  visualContinuity: jsonb("visual_continuity").notNull().default({}),
  audioPresetId: uuid("audio_preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("story_scenes_project_name_uidx").on(table.projectId, table.name),
  index("story_scenes_project_idx").on(table.projectId),
]);

export const segments = pgTable("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  storySceneId: uuid("story_scene_id").references(() => storyScenes.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  sourceRevision: integer("source_revision").notNull().default(1),
  title: text("title").notNull(),
  synopsis: text("synopsis").notNull().default(""),
  directorPrompt: text("director_prompt"),
  referenceMode: text("reference_mode").notNull().default("automatic"),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("draft"),
  videoAssetId: uuid("video_asset_id").references(() => assets.id, { onDelete: "set null" }),
  audioAssetId: uuid("audio_asset_id").references(() => assets.id, { onDelete: "set null" }),
  currentVersionNumber: integer("current_version_number").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("segments_episode_revision_sequence_uidx").on(table.episodeId, table.sourceRevision, table.sequence),
  index("segments_episode_idx").on(table.episodeId),
]);

export const shots = pgTable("shots", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  sourceRevision: integer("source_revision").notNull().default(1),
  title: text("title").notNull(),
  prompt: text("prompt").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(5000),
  shotType: text("shot_type").notNull().default("visual"),
  camera: jsonb("camera").notNull().default({}),
  soundPlan: jsonb("sound_plan").notNull().default({}),
  generationPlan: jsonb("generation_plan").notNull().default({}),
  status: text("status").notNull().default("draft"),
  firstFrameAssetId: uuid("first_frame_asset_id").references(() => assets.id, { onDelete: "set null" }),
  videoAssetId: uuid("video_asset_id").references(() => assets.id, { onDelete: "set null" }),
  environmentPresetId: uuid("environment_preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shots_episode_revision_sequence_uidx").on(table.episodeId, table.sourceRevision, table.sequence),
  index("shots_episode_idx").on(table.episodeId),
  index("shots_segment_idx").on(table.segmentId),
]);

export const shotAssetReferences = pgTable("shot_asset_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  shotId: uuid("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").references(() => characters.id, { onDelete: "cascade" }),
  characterFormId: uuid("character_form_id").references(() => characterForms.id, { onDelete: "set null" }),
  referenceRole: text("reference_role").notNull(),
  referenceOrder: integer("reference_order").notNull().default(0),
  required: boolean("required").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("shot_asset_references_shot_idx").on(table.shotId),
  uniqueIndex("shot_asset_references_unique_idx").on(table.shotId, table.referenceRole, table.referenceOrder),
]);

export const segmentAssetReferences = pgTable("segment_asset_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: uuid("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").references(() => characters.id, { onDelete: "cascade" }),
  characterFormId: uuid("character_form_id").references(() => characterForms.id, { onDelete: "set null" }),
  referenceRole: text("reference_role").notNull(),
  referenceOrder: integer("reference_order").notNull().default(0),
  required: boolean("required").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("segment_asset_references_segment_idx").on(table.segmentId),
  uniqueIndex("segment_asset_references_unique_idx").on(table.segmentId, table.referenceRole, table.referenceOrder),
]);

export const dialogueLines = pgTable("dialogue_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  shotId: uuid("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  speakerCharacterId: uuid("speaker_character_id").references(() => characters.id, { onDelete: "set null" }),
  lineType: text("line_type").notNull().default("dialogue"),
  text: text("text").notNull(),
  emotion: text("emotion"),
  delivery: jsonb("delivery").notNull().default({}),
  voiceAssetId: uuid("voice_asset_id").references(() => assets.id, { onDelete: "set null" }),
  voiceReferenceAssetId: uuid("voice_reference_asset_id").references(() => assets.id, { onDelete: "set null" }),
  audioAssetId: uuid("audio_asset_id").references(() => assets.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dialogue_lines_shot_sequence_uidx").on(table.shotId, table.sequence),
  index("dialogue_lines_shot_idx").on(table.shotId),
]);

export const audioTracks = pgTable("audio_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "cascade" }),
  shotId: uuid("shot_id").references(() => shots.id, { onDelete: "cascade" }),
  trackType: text("track_type").notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  presetId: uuid("preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  startMs: integer("start_ms").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  gainCentiDb: integer("gain_centi_db").notNull().default(0),
  config: jsonb("config").notNull().default({}),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audio_tracks_episode_type_idx").on(table.episodeId, table.trackType),
  index("audio_tracks_shot_idx").on(table.shotId),
]);

export const shotVersions = pgTable("shot_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shotId: uuid("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  prompt: text("prompt").notNull(),
  inputs: jsonb("inputs").notNull().default({}),
  resultAssetId: uuid("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  quality: jsonb("quality").notNull().default({}),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shot_versions_shot_version_uidx").on(table.shotId, table.versionNumber),
  index("shot_versions_shot_idx").on(table.shotId),
]);

export const segmentVersions = pgTable("segment_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: uuid("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  prompt: text("prompt").notNull(),
  inputs: jsonb("inputs").notNull().default({}),
  resultAssetId: uuid("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  productionMode: text("production_mode").notNull().default("unified_segment"),
  quality: jsonb("quality").notNull().default({}),
  status: text("status").notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("segment_versions_segment_version_uidx").on(table.segmentId, table.versionNumber),
  index("segment_versions_segment_idx").on(table.segmentId),
]);

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: generationStatus("status").notNull().default("waiting"),
  progress: integer("progress").notNull().default(0),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  error: jsonb("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("generation_jobs_idempotency_uidx").on(table.ownerId, table.idempotencyKey),
  index("generation_jobs_project_created_idx").on(table.projectId, table.createdAt),
]);

export const mediaJobs = pgTable("media_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  payload: jsonb("payload").notNull().default({}),
  result: jsonb("result"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("media_jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("media_jobs_owner_status_idx").on(table.ownerId, table.status),
  index("media_jobs_entity_operation_idx").on(table.entityType, table.entityId, table.operation),
]);

export const workflowBindings = pgTable("workflow_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  name: text("name").notNull(),
  workflowStorageKey: text("workflow_storage_key").notNull(),
  sourceType: text("source_type").notNull().default("upload"),
  sourceWorkflowId: text("source_workflow_id"),
  sourceVersion: text("source_version"),
  inputMapping: jsonb("input_mapping").notNull().default({}),
  outputMapping: jsonb("output_mapping").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_bindings_owner_capability_name_uidx").on(table.ownerId, table.capability, table.name),
  index("workflow_bindings_owner_source_idx").on(table.ownerId, table.sourceWorkflowId),
  index("workflow_bindings_capability_enabled_idx").on(table.capability, table.enabled),
]);

export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bridgeWorkflowId: text("bridge_workflow_id").notNull(),
  version: text("version").notNull(),
  name: text("name").notNull(),
  workflowStorageKey: text("workflow_storage_key").notNull(),
  nodeManifest: jsonb("node_manifest").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_versions_owner_bridge_version_uidx").on(table.ownerId, table.bridgeWorkflowId, table.version),
  index("workflow_versions_owner_updated_idx").on(table.ownerId, table.updatedAt),
]);

export const workflowTestRuns = pgTable("workflow_test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workflowBindingId: uuid("workflow_binding_id").notNull().references(() => workflowBindings.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  status: generationStatus("status").notNull().default("waiting"),
  comfyPromptId: text("comfy_prompt_id"),
  inputSummary: jsonb("input_summary").notNull().default({}),
  result: jsonb("result"),
  error: jsonb("error"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("workflow_test_runs_owner_created_idx").on(table.ownerId, table.createdAt),
  index("workflow_test_runs_status_idx").on(table.status),
]);

export const workflowExecutionEvents = pgTable("workflow_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  executionType: text("execution_type").notNull(),
  executionId: uuid("execution_id").notNull(),
  promptId: text("prompt_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  nodeId: text("node_id"),
  nodeTitle: text("node_title"),
  nodeValue: integer("node_value"),
  nodeMax: integer("node_max"),
  overallProgress: integer("overall_progress").notNull().default(0),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_execution_events_execution_sequence_uidx").on(table.executionType, table.executionId, table.sequence),
  index("workflow_execution_events_prompt_idx").on(table.promptId, table.sequence),
]);

export const runtimeHeartbeats = pgTable("runtime_heartbeats", {
  service: text("service").primaryKey(),
  instanceId: text("instance_id").notNull(),
  status: text("status").notNull().default("online"),
  details: jsonb("details").notNull().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
