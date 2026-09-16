import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("users_email_uidx").on(table.email)]);

export const serviceConnections = sqliteTable("service_connections", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model"),
  secretCiphertext: text("secret_ciphertext"),
  configJson: text("config_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("service_connections_owner_kind_uidx").on(table.ownerId, table.kind),
  index("service_connections_owner_idx").on(table.ownerId),
]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull().default("script"),
  status: text("status").notNull().default("draft"),
  stylePreset: text("style_preset").notNull().default("写实电影风格"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  synopsis: text("synopsis"),
  sourceText: text("source_text"),
  ...timestamps,
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const storyBibles = sqliteTable("story_bibles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceRevision: integer("source_revision").notNull().default(1),
  logline: text("logline"),
  worldJson: text("world_json").notNull().default("{}"),
  timelineJson: text("timeline_json").notNull().default("[]"),
  relationshipsJson: text("relationships_json").notNull().default("[]"),
  styleGuideJson: text("style_guide_json").notNull().default("{}"),
  narrationMode: text("narration_mode").notNull().default("dialogue"),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [uniqueIndex("story_bibles_project_uidx").on(table.projectId)]);

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  scriptText: text("script_text"),
  status: text("status").notNull().default("draft"),
  videoAssetId: text("video_asset_id"),
  subtitleAssetId: text("subtitle_asset_id"),
  currentVersionNumber: integer("current_version_number").notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex("episodes_project_number_uidx").on(table.projectId, table.episodeNumber),
  index("episodes_project_idx").on(table.projectId),
]);

export const episodeVersions = sqliteTable("episode_versions", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  resultAssetId: text("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  subtitleAssetId: text("subtitle_asset_id").references(() => assets.id, { onDelete: "set null" }),
  durationMs: integer("duration_ms").notNull().default(0),
  inputsJson: text("inputs_json").notNull().default("{}"),
  status: text("status").notNull().default("ready"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("episode_versions_episode_version_uidx").on(table.episodeId, table.versionNumber),
  index("episode_versions_episode_idx").on(table.episodeId),
]);

export const storyScenes = sqliteTable("story_scenes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id"),
  name: text("name").notNull(),
  episodeScopeJson: text("episode_scope_json").notNull().default("[]"),
  timeOfDay: text("time_of_day"),
  interiorExterior: text("interior_exterior"),
  visualContinuityJson: text("visual_continuity_json").notNull().default("{}"),
  audioPresetId: text("audio_preset_id"),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [
  uniqueIndex("story_scenes_project_name_uidx").on(table.projectId, table.name),
  index("story_scenes_project_idx").on(table.projectId),
]);

export const segments = sqliteTable("segments", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  storySceneId: text("story_scene_id").references(() => storyScenes.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  sourceRevision: integer("source_revision").notNull().default(1),
  title: text("title").notNull(),
  synopsis: text("synopsis").notNull().default(""),
  directorPrompt: text("director_prompt"),
  referenceMode: text("reference_mode").notNull().default("automatic"),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("draft"),
  videoAssetId: text("video_asset_id"),
  audioAssetId: text("audio_asset_id"),
  currentVersionNumber: integer("current_version_number").notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex("segments_episode_revision_sequence_uidx").on(table.episodeId, table.sourceRevision, table.sequence),
  index("segments_episode_idx").on(table.episodeId),
]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  assetType: text("asset_type").notNull(),
  sourceRevision: integer("source_revision"),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  storageKey: text("storage_key"),
  thumbnailUrl: text("thumbnail_url"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  ...timestamps,
}, (table) => [index("assets_project_type_idx").on(table.projectId, table.assetType)]);

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
  canonicalName: text("canonical_name").notNull(),
  profileJson: text("profile_json").notNull().default("{}"),
  voiceAssetId: text("voice_asset_id").references(() => assets.id, { onDelete: "set null" }),
  voiceDescription: text("voice_description"),
  voiceLocked: integer("voice_locked", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [index("characters_project_idx").on(table.projectId)]);

export const characterForms = sqliteTable("character_forms", {
  id: text("id").primaryKey(),
  characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
  episodeScopeJson: text("episode_scope_json").notNull().default("[]"),
  inheritVoice: integer("inherit_voice", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("character_forms_character_idx").on(table.characterId)]);

export const characterFormReferences = sqliteTable("character_form_references", {
  id: text("id").primaryKey(),
  characterFormId: text("character_form_id").notNull().references(() => characterForms.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  referenceType: text("reference_type").notNull().default("reference"),
  referenceOrder: integer("reference_order").notNull().default(0),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [
  index("character_form_references_form_idx").on(table.characterFormId),
  uniqueIndex("character_form_references_form_order_uidx").on(table.characterFormId, table.referenceOrder),
]);

export const audioPresets = sqliteTable("audio_presets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  presetType: text("preset_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
  configJson: text("config_json").notNull().default("{}"),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [index("audio_presets_project_type_idx").on(table.projectId, table.presetType)]);

export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  segmentId: text("segment_id").references(() => segments.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  sourceRevision: integer("source_revision").notNull().default(1),
  title: text("title").notNull(),
  prompt: text("prompt").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(5000),
  shotType: text("shot_type").notNull().default("visual"),
  cameraJson: text("camera_json").notNull().default("{}"),
  soundPlanJson: text("sound_plan_json").notNull().default("{}"),
  generationPlanJson: text("generation_plan_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  firstFrameAssetId: text("first_frame_asset_id").references(() => assets.id, { onDelete: "set null" }),
  videoAssetId: text("video_asset_id").references(() => assets.id, { onDelete: "set null" }),
  environmentPresetId: text("environment_preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("shots_episode_revision_sequence_uidx").on(table.episodeId, table.sourceRevision, table.sequence),
  index("shots_episode_idx").on(table.episodeId),
  index("shots_segment_idx").on(table.segmentId),
]);

export const shotAssetReferences = sqliteTable("shot_asset_references", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  characterId: text("character_id").references(() => characters.id, { onDelete: "cascade" }),
  characterFormId: text("character_form_id").references(() => characterForms.id, { onDelete: "set null" }),
  referenceRole: text("reference_role").notNull(),
  referenceOrder: integer("reference_order").notNull().default(0),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  index("shot_asset_references_shot_idx").on(table.shotId),
  uniqueIndex("shot_asset_references_unique_idx").on(table.shotId, table.referenceRole, table.referenceOrder),
]);

export const segmentAssetReferences = sqliteTable("segment_asset_references", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  characterId: text("character_id").references(() => characters.id, { onDelete: "cascade" }),
  characterFormId: text("character_form_id").references(() => characterForms.id, { onDelete: "set null" }),
  referenceRole: text("reference_role").notNull(),
  referenceOrder: integer("reference_order").notNull().default(0),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  index("segment_asset_references_segment_idx").on(table.segmentId),
  uniqueIndex("segment_asset_references_unique_idx").on(table.segmentId, table.referenceRole, table.referenceOrder),
]);

export const dialogueLines = sqliteTable("dialogue_lines", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  speakerCharacterId: text("speaker_character_id").references(() => characters.id, { onDelete: "set null" }),
  lineType: text("line_type").notNull().default("dialogue"),
  text: text("text").notNull(),
  emotion: text("emotion"),
  deliveryJson: text("delivery_json").notNull().default("{}"),
  voiceAssetId: text("voice_asset_id").references(() => assets.id, { onDelete: "set null" }),
  voiceReferenceAssetId: text("voice_reference_asset_id").references(() => assets.id, { onDelete: "set null" }),
  audioAssetId: text("audio_asset_id").references(() => assets.id, { onDelete: "set null" }),
  durationMs: integer("duration_ms"),
  ...timestamps,
}, (table) => [
  uniqueIndex("dialogue_lines_shot_sequence_uidx").on(table.shotId, table.sequence),
  index("dialogue_lines_shot_idx").on(table.shotId),
]);

export const audioTracks = sqliteTable("audio_tracks", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  segmentId: text("segment_id").references(() => segments.id, { onDelete: "cascade" }),
  shotId: text("shot_id").references(() => shots.id, { onDelete: "cascade" }),
  trackType: text("track_type").notNull(),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
  presetId: text("preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  startMs: integer("start_ms").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  gainCentiDb: integer("gain_centi_db").notNull().default(0),
  configJson: text("config_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [
  index("audio_tracks_episode_type_idx").on(table.episodeId, table.trackType),
  index("audio_tracks_shot_idx").on(table.shotId),
]);

export const shotVersions = sqliteTable("shot_versions", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  prompt: text("prompt").notNull(),
  inputsJson: text("inputs_json").notNull().default("{}"),
  resultAssetId: text("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  qualityJson: text("quality_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("shot_versions_shot_version_uidx").on(table.shotId, table.versionNumber),
  index("shot_versions_shot_idx").on(table.shotId),
]);

export const segmentVersions = sqliteTable("segment_versions", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  prompt: text("prompt").notNull(),
  inputsJson: text("inputs_json").notNull().default("{}"),
  resultAssetId: text("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
  productionMode: text("production_mode").notNull().default("unified_segment"),
  qualityJson: text("quality_json").notNull().default("{}"),
  status: text("status").notNull().default("ready"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("segment_versions_segment_version_uidx").on(table.segmentId, table.versionNumber),
  index("segment_versions_segment_idx").on(table.segmentId),
]);

export const canvasNodes = sqliteTable("canvas_nodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  nodeType: text("node_type").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  title: text("title").notNull(),
  contentJson: text("content_json").notNull().default("{}"),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  ...timestamps,
}, (table) => [index("canvas_nodes_project_idx").on(table.projectId)]);

export const canvasEdges = sqliteTable("canvas_edges", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fromNodeId: text("from_node_id").notNull().references(() => canvasNodes.id, { onDelete: "cascade" }),
  toNodeId: text("to_node_id").notNull().references(() => canvasNodes.id, { onDelete: "cascade" }),
  edgeType: text("edge_type").notNull().default("reference"),
  label: text("label").notNull().default("内容关联"),
  ...timestamps,
}, (table) => [index("canvas_edges_project_idx").on(table.projectId)]);

export const productionRoutingRules = sqliteTable("production_routing_rules", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  name: text("name").notNull(),
  conditionJson: text("condition_json").notNull().default("{}"),
  targetCapability: text("target_capability").notNull(),
  priority: integer("priority").notNull().default(100),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("production_routing_rules_owner_rule_uidx").on(table.ownerId, table.ruleKey),
  index("production_routing_rules_owner_idx").on(table.ownerId),
]);

export const workflowBindings = sqliteTable("workflow_bindings", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  name: text("name").notNull(),
  workflowStorageKey: text("workflow_storage_key").notNull(),
  sourceType: text("source_type").notNull().default("upload"),
  sourceWorkflowId: text("source_workflow_id"),
  sourceVersion: text("source_version"),
  inputContractJson: text("input_contract_json").notNull().default("{}"),
  outputContractJson: text("output_contract_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("workflow_bindings_owner_capability_uidx").on(table.ownerId, table.capability),
  index("workflow_bindings_owner_source_idx").on(table.ownerId, table.sourceWorkflowId),
]);

export const workflowVersions = sqliteTable("workflow_versions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bridgeWorkflowId: text("bridge_workflow_id").notNull(),
  version: text("version").notNull(),
  name: text("name").notNull(),
  workflowStorageKey: text("workflow_storage_key").notNull(),
  nodeManifestJson: text("node_manifest_json").notNull().default("[]"),
  ...timestamps,
}, (table) => [
  uniqueIndex("workflow_versions_owner_bridge_version_uidx").on(table.ownerId, table.bridgeWorkflowId, table.version),
  index("workflow_versions_owner_updated_idx").on(table.ownerId, table.updatedAt),
]);

export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  capability: text("capability").notNull(),
  workflowBindingId: text("workflow_binding_id").references(() => workflowBindings.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"),
  comfyPromptId: text("comfy_prompt_id"),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  ...timestamps,
}, (table) => [
  index("generation_jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("generation_jobs_owner_status_idx").on(table.ownerId, table.status),
]);

export const mediaJobs = sqliteTable("media_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  ...timestamps,
}, (table) => [
  index("media_jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("media_jobs_owner_status_idx").on(table.ownerId, table.status),
  index("media_jobs_entity_operation_idx").on(table.entityType, table.entityId, table.operation),
]);

export const workflowTestRuns = sqliteTable("workflow_test_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workflowBindingId: text("workflow_binding_id").notNull().references(() => workflowBindings.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  status: text("status").notNull().default("queued"),
  comfyPromptId: text("comfy_prompt_id"),
  inputSummaryJson: text("input_summary_json").notNull().default("{}"),
  resultJson: text("result_json"),
  errorMessage: text("error_message"),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  ...timestamps,
}, (table) => [
  index("workflow_test_runs_owner_created_idx").on(table.ownerId, table.createdAt),
  index("workflow_test_runs_status_idx").on(table.status),
]);

export const workflowExecutionEvents = sqliteTable("workflow_execution_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  executionType: text("execution_type").notNull(),
  executionId: text("execution_id").notNull(),
  promptId: text("prompt_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  nodeId: text("node_id"),
  nodeTitle: text("node_title"),
  nodeValue: integer("node_value"),
  nodeMax: integer("node_max"),
  overallProgress: integer("overall_progress").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("workflow_execution_events_execution_sequence_uidx").on(table.executionType, table.executionId, table.sequence),
  index("workflow_execution_events_prompt_idx").on(table.promptId, table.sequence),
]);

export const runtimeHeartbeats = sqliteTable("runtime_heartbeats", {
  service: text("service").primaryKey(),
  instanceId: text("instance_id").notNull(),
  status: text("status").notNull().default("online"),
  detailsJson: text("details_json").notNull().default("{}"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  ...timestamps,
});
