import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectTitle, DomainError } from "../packages/domain/dist/index.js";
import { PayloadWorkflowResolver } from "../apps/worker/dist/workflow-resolver.js";

test("project titles are normalized at the domain boundary", () => {
  assert.equal(assertProjectTitle("  山海回声  "), "山海回声");
  assert.throws(() => assertProjectTitle("   "), DomainError);
});

test("generation worker refuses an unbound workflow", async () => {
  const resolver = new PayloadWorkflowResolver();
  await assert.rejects(
    () => resolver.resolve({
      projectId: "4b776aed-8d05-4758-a458-d5e967007365",
      entityType: "shot",
      entityId: "01f9ed3d-3bd4-4df7-aec2-3cb7cbb06f65",
      capability: "image_to_video",
      idempotencyKey: "shot-1-render-1",
      payload: {},
    }),
    /WORKFLOW_NOT_BOUND:image_to_video/,
  );
});

test("generation worker returns an explicitly bound ComfyUI workflow", async () => {
  const resolver = new PayloadWorkflowResolver();
  const workflow = { "1": { class_type: "LoadImage", inputs: { image: "shot.png" } } };
  const resolved = await resolver.resolve({
    projectId: "4b776aed-8d05-4758-a458-d5e967007365",
    entityType: "shot",
    entityId: "01f9ed3d-3bd4-4df7-aec2-3cb7cbb06f65",
    capability: "image_to_video",
    idempotencyKey: "shot-1-render-1",
    payload: { workflow },
  });
  assert.deepEqual(resolved, workflow);
});
