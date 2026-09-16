#!/usr/bin/env node
/**
 * Register split Fish S2 TTS workflows into Xiaofeixiang settings.
 *
 * Usage:
 *   node scripts/bootstrap-fish-tts-bindings.mjs
 *   XIAOFEIXIANG_API_URL=http://localhost:3000 node scripts/bootstrap-fish-tts-bindings.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.XIAOFEIXIANG_API_URL ?? "http://localhost:3000";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = join(root, "integrations/comfyui/workflows");

const bindings = [
  {
    capability: "voice_synthesis",
    name: "对白 TTS · Fish 声音克隆",
    workflowFile: "fish-s2-voice-clone-api.json",
    enabled: true,
    inputContract: {
      text: { nodeId: "2", input: "text" },
      voiceReference: { nodeId: "1", input: "audio" },
      voiceDescription: { nodeId: "2", input: "reference_text" },
    },
    outputContract: { nodeId: "3", output: "audio", mediaType: "audio" },
  },
  {
    capability: "voice_synthesis",
    name: "对白 TTS · Fish 纯文本",
    workflowFile: "fish-s2-tts-plain-api.json",
    enabled: false,
    inputContract: {
      text: { nodeId: "1", input: "text" },
    },
    outputContract: { nodeId: "2", output: "audio", mediaType: "audio" },
  },
];

for (const binding of bindings) {
  const workflow = JSON.parse(readFileSync(join(workflowDir, binding.workflowFile), "utf8"));
  const response = await fetch(`${BASE}/api/workflows/bindings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      capability: binding.capability,
      name: binding.name,
      workflow,
      inputContract: binding.inputContract,
      outputContract: binding.outputContract,
      enabled: binding.enabled,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error(`✗ ${binding.name}`, data.error?.message ?? response.status, data.error?.details ?? "");
    process.exitCode = 1;
    continue;
  }
  console.log(`✓ ${binding.name} (${data.binding.id})${binding.enabled ? "" : " [disabled]"}`);
}

console.log("\n下一步：设置 → 音频 → 对白 TTS → 选「Fish 声音克隆」→ 保存绑定并测试。");
