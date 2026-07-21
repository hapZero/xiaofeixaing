import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ships the approved Xiaofeixiang creation flow", async () => {
  const [page, layout, packageJson] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/layout.tsx"),
    read("../package.json"),
  ]);
  assert.match(page, /function FreeCanvasPage/);
  assert.match(page, /function CanvasWorkspace/);
  assert.match(page, /FlowCanvasLines/);
  assert.match(page, /进入自由画布/);
  assert.match(page, /固定角色音色/);
  assert.match(layout, /小飞象/);
  assert.match(packageJson, /xiaofeixiang-studio/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});

test("defines durable product data and ComfyUI job boundaries", async () => {
  const [schema, migration, jobsRoute, requirements] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0000_gifted_vanisher.sql"),
    read("../app/api/generation/jobs/route.ts"),
    read("../app/lib/workflow-capabilities.ts"),
  ]);
  for (const table of ["users", "projects", "episodes", "assets", "characters", "shots", "canvasNodes", "canvasEdges", "workflowBindings", "generationJobs"]) {
    assert.match(schema, new RegExp(`export const ${table}`));
  }
  assert.match(migration, /CREATE TABLE `generation_jobs`/);
  assert.match(jobsRoute, /WORKFLOW_REQUIRED/);
  assert.match(jobsRoute, /queueWorkflow/);
  assert.match(requirements, /native_audio_video/);
  assert.match(requirements, /ambient_audio/);
});

test("canvas API persists nodes and edges for an owned project", async () => {
  const route = await read("../app/api/projects/[projectId]/canvas/route.ts");
  assert.match(route, /getOwnedProject/);
  assert.match(route, /DELETE FROM canvas_edges/);
  assert.match(route, /INSERT INTO canvas_nodes/);
  assert.match(route, /INSERT INTO canvas_edges/);
  assert.match(route, /CANVAS_TOO_LARGE/);
});
