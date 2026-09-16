#!/usr/bin/env node
/**
 * Bind ChatterBox multilingual TTS workflow to voice_synthesis.
 * Usage: node scripts/bootstrap-chatterbox-voice-binding.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.XIAOFEIXIANG_API_URL ?? "http://localhost:3000";
const workflowPath = join(dirname(fileURLToPath(import.meta.url)), "../integrations/comfyui/workflows/chatterbox-voice-synthesis-api.json");

const body = {
  capability: "voice_synthesis",
  name: "对白 TTS · ChatterBox 中文克隆",
  workflow: JSON.parse(readFileSync(workflowPath, "utf8")),
  inputContract: {
    text: { nodeId: "2", input: "text" },
    voiceReference: { nodeId: "1", input: "audio" },
  },
  outputContract: {
    nodeId: "3",
    output: "audio",
    mediaType: "audio",
  },
  enabled: true,
};

const res = await fetch(`${BASE}/api/workflows/bindings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) {
  console.error(data.error?.message ?? res.status, data.error?.details ?? "");
  process.exit(1);
}
console.log(`✓ voice_synthesis -> ${data.binding.name} (${data.binding.id})`);
console.log("请在设置 → 音频 → 对白 TTS 中运行一次真实测试。");
