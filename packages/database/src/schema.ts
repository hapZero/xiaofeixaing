import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const projectSourceType = pgEnum("project_source_type", ["upload", "ai_script", "canvas"]);
export const projectStatus = pgEnum("project_status", ["draft", "scripting", "assets", "storyboarding", "rendering", "completed", "failed"]);
export const generationStatus = pgEnum("generation_status", ["waiting", "active", "succeeded", "failed", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_phone_uidx").on(table.phone)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: projectSourceType("source_type").notNull(),
  status: projectStatus("status").notNull().default("draft"),
  stylePreset: text("style_preset").notNull().default("写实电影风格"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  synopsis: text("synopsis"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

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
