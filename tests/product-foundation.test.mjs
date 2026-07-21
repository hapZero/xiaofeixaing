import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ships the approved Xiaofeixiang creation flow", async () => {
  const [page, studio, canvas, assets, layout, packageJson] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/canvas/CanvasWorkspace.tsx"),
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/layout.tsx"),
    read("../package.json"),
  ]);
  assert.match(page, /StudioApp/);
  assert.match(studio, /FreeCanvasPage/);
  assert.match(canvas, /function CanvasWorkspace/);
  assert.match(canvas, /FlowCanvasLines/);
  assert.match(canvas, /已自动保存/);
  assert.match(assets, /固定角色音色/);
  assert.match(layout, /小飞象/);
  assert.match(packageJson, /xiaofeixiang-studio/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});

test("keeps the frontend entrypoint thin and features modular", async () => {
  const [page, plan] = await Promise.all([
    read("../app/page.tsx"),
    read("../docs/development-plan.md"),
  ]);
  assert.ok(page.split("\n").length < 20);
  assert.match(plan, /apps\/web/);
  assert.match(plan, /PostgreSQL/);
  assert.match(plan, /Redis、BullMQ/);
  assert.match(plan, /当前 D1\/R2 版本只作为在线原型/);
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

test("connects account-owned projects to the visible creation flow", async () => {
  const [login, studio, drama, projectRoute, episodeRoute, script] = await Promise.all([
    read("../app/features/auth/Login.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/drama/DramaHub.tsx"),
    read("../app/api/projects/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/route.ts"),
    read("../app/features/script/ScriptPage.tsx"),
  ]);
  assert.match(login, /fetch\("\/api\/me"/);
  assert.match(studio, /activeProject/);
  assert.match(drama, /fetch\("\/api\/projects"/);
  assert.match(drama, /initialScript/);
  assert.match(projectRoute, /getD1\(\)\.batch/);
  assert.match(episodeRoute, /getOwnedProject/);
  assert.match(script, /800/);
  assert.match(script, /确认剧本，进入资产库/);
});
