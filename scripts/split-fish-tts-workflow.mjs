#!/usr/bin/env node
/**
 * Split the bundled Fish S2 editor workflow into three API-format workflows.
 *
 * Usage:
 *   node scripts/split-fish-tts-workflow.mjs
 *   node scripts/split-fish-tts-workflow.mjs "/path/to/TTS-声音克隆-多人克隆 .json"
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(process.env.HOME ?? "", "Downloads", "TTS-声音克隆-多人克隆 .json");
const sourcePath = process.argv[2] ?? defaultSource;

const bundles = [
  {
    repoName: "fish-s2-tts-plain-api.json",
    exportName: "TTS-Fish-纯文本-API.json",
    title: "Fish S2 · 纯文本 TTS",
    capability: "voice_synthesis",
    bindingName: "对白 TTS · Fish 纯文本",
    enabled: false,
    inputContract: {
      text: { nodeId: "1", input: "text" },
    },
    outputContract: { nodeId: "2", output: "audio", mediaType: "audio" },
  },
  {
    repoName: "fish-s2-voice-clone-api.json",
    exportName: "TTS-Fish-声音克隆-API.json",
    title: "Fish S2 · 声音克隆（无 Whisper 依赖）",
    capability: "voice_synthesis",
    bindingName: "对白 TTS · Fish 声音克隆",
    enabled: true,
    inputContract: {
      text: { nodeId: "2", input: "text" },
      voiceReference: { nodeId: "1", input: "audio" },
      voiceDescription: { nodeId: "2", input: "reference_text" },
    },
    outputContract: { nodeId: "3", output: "audio", mediaType: "audio" },
  },
  {
    repoName: "fish-s2-multi-speaker-api.json",
    exportName: "TTS-Fish-多人克隆-API.json",
    title: "Fish S2 · 多人克隆",
    capability: null,
    bindingName: null,
    enabled: false,
    note: "平台主线暂不支持双参考音频绑定；可在 ComfyUI 里单独测试，或等后续扩展能力项。",
    inputContract: null,
    outputContract: { nodeId: "4", output: "audio", mediaType: "audio" },
  },
];

if (!existsSync(sourcePath)) {
  console.warn(`源文件不存在，跳过校验：${sourcePath}`);
} else {
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const groups = Object.fromEntries((source.groups ?? []).map((group) => [group.title, group.id]));
  const nodeTypes = Object.fromEntries((source.nodes ?? []).map((node) => [node.id, node.type]));
  const expected = {
    TTS: ["FishS2TTS", "PreviewAudio"],
    "Voice Clone": ["FishS2VoiceCloneTTS", "LoadAudio", "PreviewAudio"],
    "Multi Speaker Clone": ["FishS2MultiSpeakerTTS", "LoadAudio", "PreviewAudio"],
    "whisper STT Voice Clone (Optional)": ["Load Whisper (mtb)", "Audio To Text (mtb)", "ShowText|pysssss", "ComfySwitchNode", "PrimitiveBoolean", "Text Box line spot"],
  };
  for (const [title, types] of Object.entries(expected)) {
    if (!groups[title]) console.warn(`警告：源工作流缺少分组 ${title}`);
    types.forEach((type) => {
      if (!Object.values(nodeTypes).includes(type)) console.warn(`警告：源工作流缺少节点类型 ${type}`);
    });
  }
}

const workflowDir = join(root, "integrations/comfyui/workflows");
const exportDir = join(process.env.HOME ?? "", "Downloads", "xiaofeixiang-fish-tts-split");
mkdirSync(exportDir, { recursive: true });

const manifest = [];

for (const bundle of bundles) {
  const repoPath = join(workflowDir, bundle.repoName);
  const exportPath = join(exportDir, bundle.exportName);
  copyFileSync(repoPath, exportPath);
  manifest.push({
    title: bundle.title,
    repoPath,
    exportPath,
    capability: bundle.capability,
    bindingName: bundle.bindingName,
    enabled: bundle.enabled,
    inputContract: bundle.inputContract,
    outputContract: bundle.outputContract,
    note: bundle.note ?? null,
  });
}

writeFileSync(join(exportDir, "binding-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("已拆分 Fish S2 TTS 工作流：");
manifest.forEach((item) => {
  console.log(`- ${item.title}`);
  console.log(`  文件: ${item.exportPath}`);
  if (item.capability) {
    console.log(`  建议绑定: 设置 → 音频 → ${item.capability === "voice_synthesis" ? "对白 TTS" : item.capability}`);
    console.log(`  配置名: ${item.bindingName}${item.enabled ? "（推荐启用）" : "（备用，默认不自动注册）"}`);
    console.log(`  输入映射: ${JSON.stringify(item.inputContract)}`);
    console.log(`  输出节点: ${item.outputContract.nodeId} · PreviewAudio / audio`);
  } else if (item.note) {
    console.log(`  说明: ${item.note}`);
  }
});
console.log(`\n绑定清单: ${join(exportDir, "binding-manifest.json")}`);
