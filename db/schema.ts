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

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull().default("script"),
  status: text("status").notNull().default("draft"),
  stylePreset: text("style_preset").notNull().default("写实电影风格"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  synopsis: text("synopsis"),
  ...timestamps,
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  scriptText: text("script_text"),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [
  uniqueIndex("episodes_project_number_uidx").on(table.projectId, table.episodeNumber),
  index("episodes_project_idx").on(table.projectId),
]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  assetType: text("asset_type").notNull(),
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
  assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
  episodeScopeJson: text("episode_scope_json").notNull().default("[]"),
  inheritVoice: integer("inherit_voice", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("character_forms_character_idx").on(table.characterId)]);

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
  sequence: integer("sequence").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(5000),
  status: text("status").notNull().default("draft"),
  firstFrameAssetId: text("first_frame_asset_id").references(() => assets.id, { onDelete: "set null" }),
  videoAssetId: text("video_asset_id").references(() => assets.id, { onDelete: "set null" }),
  environmentPresetId: text("environment_preset_id").references(() => audioPresets.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("shots_episode_sequence_uidx").on(table.episodeId, table.sequence),
  index("shots_episode_idx").on(table.episodeId),
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
}, (table) => [uniqueIndex("workflow_bindings_owner_capability_uidx").on(table.ownerId, table.capability)]);

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
