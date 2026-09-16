#!/usr/bin/env node
/**
 * One-shot helper: bind Spark ComfyUI workflows to Xiaofeixiang capabilities.
 * Usage: node scripts/bootstrap-workflow-bindings.mjs [--test]
 */

const BASE = process.env.XIAOFEIXIANG_API_URL ?? "http://localhost:3000";

const BINDINGS = [
  {
    capability: "image_generation",
    name: "通用图像生成 · 文生图",
    bridgeWorkflowId: "75a73d98bc1d9d5b13ae",
    inputContract: { prompt: { nodeId: "76:6", input: "text" } },
    outputContract: { nodeId: "60", output: "images", mediaType: "image" },
  },
  {
    capability: "storyboard_frame",
    name: "分镜首帧 · 文生图",
    bridgeWorkflowId: "75a73d98bc1d9d5b13ae",
    inputContract: { prompt: { nodeId: "76:6", input: "text" } },
    outputContract: { nodeId: "60", output: "images", mediaType: "image" },
  },
  {
    capability: "character_image",
    name: "人物一致性生成器",
    bridgeWorkflowId: "db25314ebbf289c0868f",
    inputContract: {
      prompt: { nodeId: "515", input: "string" },
      referenceImage: { nodeId: "213", input: "image" },
    },
    outputContract: { nodeId: "208", output: "images", mediaType: "image", collectAllImages: true },
  },
  {
    capability: "image_to_video",
    name: "图生视频 · LTX图生视频",
    bridgeWorkflowId: "cb7b76c3083ea4928bcb",
    inputContract: {
      firstFrame: { nodeId: "269", input: "image" },
      prompt: { nodeId: "320:319", input: "value" },
      duration: { nodeId: "320:301", input: "value" },
      promptEnhance: { nodeId: "320:328", input: "value" },
    },
    outputContract: { nodeId: "75", output: "videos", mediaType: "video" },
  },
  {
    capability: "text_to_video",
    name: "文生视频 · LTX图生视频",
    bridgeWorkflowId: "cb7b76c3083ea4928bcb",
    inputContract: {
      prompt: { nodeId: "320:319", input: "value" },
      duration: { nodeId: "320:301", input: "value" },
    },
    outputContract: { nodeId: "75", output: "videos", mediaType: "video" },
  },
  {
    capability: "first_last_frame_video",
    name: "首尾帧视频 · 首尾帧视频",
    bridgeWorkflowId: "00029074ab4d85ad51db",
    inputContract: {
      firstFrame: { nodeId: "31", input: "image" },
      lastFrame: { nodeId: "39", input: "image" },
      prompt: { nodeId: "129:112", input: "text" },
      duration: { nodeId: "129:102", input: "value" },
    },
    outputContract: { nodeId: "68", output: "video", mediaType: "video" },
  },
  {
    capability: "native_audio_video",
    name: "原生有声视频 · LTX图生视频_音频口型_seed_fixed_exposed",
    bridgeWorkflowId: "1aafda48065f152a64ee",
    inputContract: {
      firstFrame: { nodeId: "269", input: "image" },
      audio: { nodeId: "276", input: "audio" },
      prompt: { nodeId: "340:319", input: "value" },
      duration: { nodeId: "340:331", input: "value" },
    },
    outputContract: { nodeId: "341", output: "videos", mediaType: "video" },
  },
  {
    capability: "reference_video_character",
    name: "参考视频换角色 · 视频换角色",
    bridgeWorkflowId: "476643d05d5bd6c2fed8",
    inputContract: {
      video: { nodeId: "63", input: "video" },
      referenceImage: { nodeId: "57", input: "image" },
    },
    outputContract: { nodeId: "186", output: "videos", mediaType: "video" },
  },
];

async function saveBinding(spec) {
  const bridgeRes = await fetch(`${BASE}/api/workflows/bridge?workflowId=${encodeURIComponent(spec.bridgeWorkflowId)}`);
  const bridge = await bridgeRes.json();
  if (!bridgeRes.ok) throw new Error(`${spec.capability}: bridge read failed ${bridgeRes.status}`);
  const version = bridge.version ?? bridge.workflow?.latestVersion;
  const body = {
    capability: spec.capability,
    name: spec.name,
    bridgeWorkflowId: spec.bridgeWorkflowId,
    bridgeVersion: version,
    inputContract: spec.inputContract,
    outputContract: spec.outputContract,
    enabled: true,
  };
  const res = await fetch(`${BASE}/api/workflows/bindings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${spec.capability}: ${data.error?.message ?? res.status} ${JSON.stringify(data.error?.details ?? {})}`);
  return data.binding;
}

async function main() {
  console.log(`Binding via ${BASE}`);
  for (const spec of BINDINGS) {
    const binding = await saveBinding(spec);
    console.log(`✓ ${spec.capability} -> ${spec.name} (${binding.id})`);
  }
  const req = await fetch(`${BASE}/api/workflows/requirements`).then((r) => r.json());
  console.log("\nRoute readiness:");
  for (const route of req.routes ?? []) {
    console.log(`- ${route.name}: ${route.status}${route.completedStrategies?.length ? ` (${route.completedStrategies.join(", ")})` : ""}`);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
