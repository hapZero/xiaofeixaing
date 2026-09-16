"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AppButton } from "../../components/ui";
import { EngineConnectionsPanel } from "./EngineConnectionsPanel";
import type { ProductionRoutingRule } from "../../lib/production-routing-rules";
import { getWorkflowCapability, isWorkflowCapability, orderedSettingsCapabilities, routingRuleGroups, settingsMenuSections, workflowCapabilities, type SettingsSection } from "../../lib/workflow-capabilities";
import { resolveWorkflowBinding } from "../../lib/workflow-routing";
import type { MainlineStage, ProductionMainlineReadiness, WorkflowCapabilityInfo, WorkflowInputDefinition } from "../studio/types";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
type WorkflowDocument = Record<string, WorkflowNode>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json"; collectAllImages?: boolean };
type WorkflowBinding = { id: string; capability: string; name: string; sourceType?: string; sourceWorkflowId?: string | null; sourceVersion?: string | null; inputContract: InputContract; outputContract: OutputContract; enabled: boolean };
type ExecutionProgress = { source: "bridge"; overall: number; stage: string; currentNodeId: string | null; currentNodeTitle: string | null; nodeValue: number | null; nodeMax: number | null; completedNodes: number; totalNodes: number; cachedNodes: number; lastSequence: number };
type WorkflowTestRun = {
  id: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string | number | Date;
  result?: { outputUrl?: string; durationSeconds?: number | null; mediaType?: "image" | "video" | "audio" | "json"; outputCount?: number } | null;
};
type TestInputValue = string | boolean | File | File[] | null;
type ConnectionState = { configured: boolean; connected: boolean; deviceCount?: number; system?: string | null; serverUrl?: string | null; message: string };
type SparkWorkflow = {
  name: string;
  format: "api" | "editor" | "unknown";
  nodeCount: number;
  nodeTypes: string[];
  suggestedCapability: string | null;
  suggestedLabel: string;
  outputNodeTypes: string[];
};
type BridgeWorkflow = { id: string; name: string; latestVersion: string; updatedAt: number; nodeCount: number; nodes: Array<{ id: string; classType: string; title: string; weight: number }>; suggestedCapabilities: string[] };
type BridgeState = { installed: boolean; version: string | null; authorized: boolean };
type WorkflowPreparation = { id: string; name: string; status: "queued" | "preparing" | "succeeded" | "failed"; workflowId: string | null; version: string | null; error: string | null };
type PreparedWorkflowResponse = { preparation?: WorkflowPreparation; workflow?: BridgeWorkflow; api?: unknown; error?: { message?: string } };

const MAX_TEST_FRAME_BYTES = 15 * 1024 * 1024;

function normalizedWorkflowName(name: string) {
  return name.replace(/^workflows\//i, "").replace(/\.json$/i, "").trim().toLowerCase();
}

function capabilityKindLabel(key: string) {
  if (["image_generation", "video_generation"].includes(key)) return "基础能力";
  if (["voice_synthesis", "lip_sync"].includes(key)) return "声音补充";
  if (key === "native_audio_video") return "完整方案";
  if (key === "ambient_audio") return "可选增强";
  return "专用覆盖";
}

function capabilitySuggestionMatches(selected: string, suggested: string | null) {
  if (selected === suggested) return true;
  if (selected === "image_generation") return ["storyboard_frame"].includes(suggested ?? "");
  if (selected === "character_image") return suggested === "character_image";
  if (selected === "video_generation") return ["image_to_video", "multi_subject_video", "first_last_frame_video"].includes(suggested ?? "");
  return false;
}

const inputAliases: Record<string, string[]> = {
  script: ["script", "text", "prompt"],
  prompt: ["prompt", "positive", "positive_prompt", "text"],
  referenceImage: ["reference_image", "image", "image_path", "filename"],
  characterImages: ["character_images", "reference_images", "images", "image"],
  sceneImage: ["scene_image", "background_image", "image"],
  firstFrame: ["first_frame", "start_image", "image"],
  lastFrame: ["last_frame", "end_image", "image"],
  referenceImages: ["reference_images", "images", "image"],
  propImages: ["prop_images", "images", "image"],
  emotion: ["emotion", "mood", "style"],
  aspectRatio: ["aspect_ratio", "ratio"],
  stylePreset: ["style_preset", "style"],
  duration: ["duration", "seconds", "length", "frames"],
  promptEnhance: ["prompt_enhance", "enhance_prompt", "enhance", "value"],
  text: ["text", "prompt"],
  voiceReference: ["voice_reference", "reference_audio", "audio"],
  voiceDescription: ["voice_description", "description", "prompt"],
  video: ["video", "video_path", "filename"],
  audio: ["audio", "audio_path", "filename"],
  referenceAudio: ["reference_audio", "audio"],
  timeline: ["timeline", "clips", "videos"],
  subtitles: ["subtitles", "subtitle", "srt"],
};

function nodeLabel(nodeId: string, node: WorkflowNode) {
  return `${nodeId} · ${node._meta?.title || node.class_type || "未命名节点"}`;
}

function isMultiImagePackCapability(key: string | undefined) {
  return key === "character_image";
}

function workflowOutputNodeEntries(workflow: WorkflowDocument | null, mediaType: string) {
  if (!workflow) return [] as Array<[string, WorkflowNode]>;
  const patterns = mediaType === "image"
    ? [/saveimage/i, /previewimage/i]
    : mediaType === "video"
      ? [/savevideo/i, /videocombine/i, /vhs.*video/i, /combine.*video/i]
      : mediaType === "audio"
        ? [/saveaudio/i, /previewaudio/i, /audio.*save/i, /combine.*audio/i]
        : [/save|output/i];
  return Object.entries(workflow).filter(([, node]) => patterns.some((pattern) => pattern.test(node.class_type ?? "")));
}

function preferStoryboardReferenceContract(workflow: WorkflowDocument, contract: InputContract) {
  const next = { ...contract };
  const byTitle = (pattern: RegExp) => Object.entries(workflow).find(([, node]) => /loadimage/i.test(node.class_type ?? "") && pattern.test(String(node._meta?.title ?? "")));
  const scene = byTitle(/scene|场景|background|背景/i);
  const character = byTitle(/角色参考1|character.*1|first character/i) ?? byTitle(/character|角色/i);
  if (scene && Object.prototype.hasOwnProperty.call(scene[1].inputs ?? {}, "image")) next.sceneImage = { nodeId: scene[0], input: "image" };
  if (character && Object.prototype.hasOwnProperty.call(character[1].inputs ?? {}, "image")) next.characterImages = { nodeId: character[0], input: "image" };
  return next;
}

function preferCharacterImageContract(workflow: WorkflowDocument, contract: InputContract) {
  const next = { ...contract };
  const promptNode = Object.entries(workflow).find(([, node]) => /stringconstantmultiline/i.test(node.class_type ?? "") && /prompt|角色描述|one sentence/i.test(node._meta?.title ?? ""));
  if (promptNode && Object.prototype.hasOwnProperty.call(promptNode[1].inputs ?? {}, "string")) next.prompt = { nodeId: promptNode[0], input: "string" };
  const loadImage = Object.entries(workflow).find(([, node]) => /loadimage/i.test(node.class_type ?? "") && Object.prototype.hasOwnProperty.call(node.inputs ?? {}, "image"));
  if (loadImage) next.referenceImage = { nodeId: loadImage[0], input: "image" };
  return next;
}

function buildMultiImageOutputContract(workflow: WorkflowDocument): OutputContract {
  return { nodeId: suggestOutputNode(workflow, "image"), output: "images", mediaType: "image", collectAllImages: true };
}

function defaultOutputCollection(mediaType: string) {
  if (mediaType === "video") return "videos";
  if (mediaType === "audio") return "audio";
  if (mediaType === "json") return "result";
  return "images";
}

function mergeImageListFiles(current: File[], incoming: File[]) {
  const merged = [...current];
  incoming.forEach((file) => {
    if (!merged.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) merged.push(file);
  });
  return merged;
}

function imageListTestHint(capabilityKey: string) {
  if (capabilityKey === "multi_reference_image") return "至少添加 2 张参考图，可多次点击「继续添加」";
  return "可一次多选，也可多次添加 · 每张最大 15 MB";
}

function TestImageListField({ input, files, capabilityKey, onChange, onStatus }: {
  input: WorkflowInputDefinition;
  files: File[];
  capabilityKey: string;
  onChange: (files: File[]) => void;
  onStatus: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = (incoming: File[]) => {
    const next = mergeImageListFiles(files, incoming);
    onChange(next);
    onStatus(next.length ? `${input.label}已选择 ${next.length} 张，可以开始测试` : "");
  };

  return <div className={`test-image-list-upload ${files.length ? "selected" : ""}`}>
    <div className="test-image-list-header">
      <div><b>{input.label}{input.required ? " *" : ""}</b><small>{imageListTestHint(capabilityKey)}</small></div>
      <div className="test-image-list-actions">
        <AppButton onClick={() => inputRef.current?.click()}>{files.length ? "继续添加" : "添加图片"}</AppButton>
        {files.length > 0 && <button type="button" className="test-image-list-clear" onClick={() => { onChange([]); onStatus(""); }}>清空</button>}
      </div>
    </div>
    <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    {files.length > 0
      ? <ul className="test-image-list-files">{files.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}><span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small><button type="button" aria-label={`移除 ${file.name}`} onClick={() => { const next = files.filter((_, itemIndex) => itemIndex !== index); onChange(next); onStatus(next.length ? `${input.label}已选择 ${next.length} 张，可以开始测试` : ""); }}>移除</button></li>)}</ul>
      : <div className="test-image-list-empty"><span>＋</span><p>点击「添加图片」选择一张或多张参考图</p></div>}
  </div>;
}

function isTestInputMissing(input: WorkflowInputDefinition, value: TestInputValue, capabilityKey?: string) {
  if (input.valueType === "imageList") {
    const count = Array.isArray(value) ? value.length : 0;
    if (count === 0) return true;
    if (capabilityKey === "multi_reference_image" && count < 2) return true;
    return false;
  }
  if (value instanceof File) return false;
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === "";
}

function formatTestInputSummary(input: WorkflowInputDefinition, value: TestInputValue) {
  if (input.valueType === "imageList" && Array.isArray(value)) {
    return value.length ? `已选择 ${value.length} 张图片` : `${input.required ? "上传" : "可选上传"}${input.label}`;
  }
  if (value instanceof File) return value.name;
  return `${input.required ? "上传" : "可选上传"}${input.label}`;
}

function defaultTestInputs(capability: WorkflowCapabilityInfo | null): Record<string, TestInputValue> {
  return Object.fromEntries((capability?.inputs ?? []).map((input) => {
    if (input.valueType === "boolean") return [input.key, false];
    if (input.valueType === "imageList") return [input.key, []];
    if (input.key === "duration") return [input.key, "5"];
    return [input.key, ""];
  }));
}

function scoreInput(definition: WorkflowInputDefinition, inputName: string, node: WorkflowNode) {
  const normalized = inputName.toLowerCase();
  const title = `${node.class_type ?? ""} ${node._meta?.title ?? ""}`.toLowerCase();
  const aliases = inputAliases[definition.key] ?? [definition.key.toLowerCase()];
  let score = aliases.reduce((best, alias) => Math.max(best, normalized === alias ? 100 : normalized.includes(alias) ? 65 : 0), 0);
  if (["prompt", "text", "script"].includes(definition.key) && /cliptextencode|textencode/.test(title)) score += 25;
  if (definition.valueType === "image" && /loadimage/.test(title)) score += 25;
  if (definition.valueType === "imageList" && /loadimage|imagebatch|batch.*image/.test(title)) score += 25;
  if (definition.valueType === "audio" && /loadaudio|audio.*load/.test(title)) score += 25;
  if (definition.valueType === "video" && /loadvideo|video.*load/.test(title)) score += 25;
  if (definition.key === "prompt" && /positive|正向/.test(title)) score += 30;
  if (definition.key === "prompt" && /negative|负向/.test(title)) score -= 60;
  if (definition.key === "prompt" && /stringconstantmultiline|string constant/.test(title) && /prompt|角色描述|one sentence|describe style/i.test(title) && normalized === "string") score += 220;
  if (definition.key === "prompt" && /textencodeqwenimageedit|cliptextencode|textencode/.test(title) && normalized === "prompt") score -= 50;
  if (definition.key === "sceneImage" && /scene|场景|background|背景/.test(title)) score += 320;
  if (definition.key === "characterImages" && /character|角色/.test(title) && !/scene|场景|background|背景/.test(title)) score += 320;
  if (definition.key === "characterImages" && /角色参考1|character.*1|first character|image2/.test(title)) score += 40;
  if (definition.key === "voiceDescription" && /reference.?text|ref.?text|transcript|转写|参考文本/i.test(title)) score += 320;
  if (definition.key === "text" && /fishs2voiceclone|voice.?clone/i.test(title) && normalized === "text") score += 280;
  if (definition.key === "referenceImages" && /reference|参考/.test(title)) score += 180;
  const semanticTitles: Partial<Record<string, RegExp>> = {
    prompt: /(^|\s)prompt($|\s)|提示词|动作描述/,
    duration: /(^|\s)duration($|\s)|时长/,
    promptEnhance: /prompt.?enhance|enhance.?prompt|提示词增强|提示增强/,
    aspectRatio: /aspect.?ratio|画幅|宽高比/,
  };
  if (semanticTitles[definition.key]?.test(title) && /^(value|text|image|audio|video)$/.test(normalized)) score += 180;
  const currentValue = node.inputs?.[inputName];
  if (Array.isArray(currentValue) && currentValue.length === 2 && typeof currentValue[0] === "string") score -= 250;
  return score;
}

function suggestInputContract(workflow: WorkflowDocument, capability: WorkflowCapabilityInfo): InputContract {
  const candidates = Object.entries(workflow).flatMap(([nodeId, node]) => Object.keys(node.inputs ?? {}).map((input) => ({ nodeId, input, node })));
  const used = new Set<string>();
  const contract: InputContract = {};
  capability.inputs.forEach((definition) => {
    const ranked = candidates
      .map((candidate) => ({ ...candidate, score: scoreInput(definition, candidate.input, candidate.node) }))
      .filter((candidate) => candidate.score > 0 && !used.has(`${candidate.nodeId}::${candidate.input}`))
      .sort((a, b) => b.score - a.score);
    if (!ranked[0]) return;
    contract[definition.key] = { nodeId: ranked[0].nodeId, input: ranked[0].input };
    used.add(`${ranked[0].nodeId}::${ranked[0].input}`);
  });
  return contract;
}

function suggestOutputNode(workflow: WorkflowDocument, mediaType: string) {
  return workflowOutputNodeEntries(workflow, mediaType)[0]?.[0] ?? "";
}

function isApiWorkflow(value: unknown): value is WorkflowDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nodes = Object.values(value as Record<string, unknown>);
  return nodes.length > 0 && nodes.every((node) => node && typeof node === "object" && typeof (node as WorkflowNode).class_type === "string");
}

async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (response.status === 413 || text.includes("Payload Too Large")) {
      throw new Error("首帧文件超过 15 MB，请压缩图片后重试");
    }
    throw new Error(response.ok ? "服务返回了无法识别的数据" : `请求失败（${response.status}）`);
  }
}

function describeTestError(message?: string | null) {
  if (!message) return "请检查工作流参数和输出映射";
  if (message.startsWith("COMFYUI_EXECUTION_FAILED:")) {
    const detail = message.slice("COMFYUI_EXECUTION_FAILED:".length).trim();
    return detail || "ComfyUI 工作流执行失败，请查看 Spark 节点日志";
  }
  if (message === "COMFYUI_EXECUTION_FAILED") return "ComfyUI 工作流执行失败，请查看 Spark 节点日志";
  if (message.startsWith("COMFYUI_QUEUE_FAILED:")) {
    const detail = message.slice("COMFYUI_QUEUE_FAILED:".length).replace(/^\d+:?/, "").trim();
    return detail ? `ComfyUI 拒绝了这次工作流：${detail}` : "ComfyUI 拒绝了这次工作流，请检查字段映射与参考图数量";
  }
  if (message.startsWith("WORKFLOW_VIDEO_TOO_SHORT:")) {
    const [actual, expected] = message.slice("WORKFLOW_VIDEO_TOO_SHORT:".length).split("/");
    return `工作流返回的视频时长异常（实际 ${actual}，要求 ${expected}）`;
  }
  if (message.startsWith("WORKFLOW_INPUT_TARGET_IS_LINK:")) return "工作流输入错误地绑定到了内部连线，请重新绑定执行版";
  if (message.startsWith("WORKFLOW_INPUT_NOT_APPLIED:")) {
    const detail = message.slice("WORKFLOW_INPUT_NOT_APPLIED:".length);
    if (/characterImages|sceneImage|referenceImages|propImages/.test(detail)) {
      return "你上传的参考图没有写进 ComfyUI 工作流（常见原因是场景图/角色图节点映射反了）；请在设置里重新保存绑定，确认「场景参考图→场景节点、角色参考图→角色节点」后再测试";
    }
    return "你上传的参考图/首帧没有写进 ComfyUI 工作流，实际仍在用工作流里保存的旧图片（例如 shot_08.png）；请确认映射到正确的 LoadImage 节点后重新测试";
  }
  if (message.startsWith("WORKFLOW_INPUT_NOT_MAPPED:")) {
    return `工作流绑定缺少必填映射：${message.slice("WORKFLOW_INPUT_NOT_MAPPED:".length)}；请在设置里重新保存该能力的工作流绑定`;
  }
  if (/is not defined$/i.test(message) || message.includes("ReferenceError")) {
    return "服务端代码未加载最新版本，请重启本地 dev（npm run dev）后重新测试";
  }
  return message;
}

export function SettingsModal({ section: initialSection = "readiness", capabilityKey: initialCapabilityKey = null, onClose }: { section?: SettingsSection; capabilityKey?: string | null; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [mainline, setMainline] = useState<ProductionMainlineReadiness | null>(null);
  const [routingRules, setRoutingRules] = useState<ProductionRoutingRule[]>([]);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [capabilities, setCapabilities] = useState<WorkflowCapabilityInfo[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState(initialCapabilityKey ?? "storyboard_frame");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [sparkWorkflows, setSparkWorkflows] = useState<SparkWorkflow[]>([]);
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const [bridgeWorkflows, setBridgeWorkflows] = useState<BridgeWorkflow[]>([]);
  const [selectedBridgeWorkflow, setSelectedBridgeWorkflow] = useState<BridgeWorkflow | null>(null);
  const [sparkLoading, setSparkLoading] = useState(true);
  const [selectedSparkName, setSelectedSparkName] = useState("");
  const [preparingWorkflowName, setPreparingWorkflowName] = useState("");
  const [testing, setTesting] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowDocument | null>(null);
  const [workflowFileName, setWorkflowFileName] = useState("");
  const [bindingName, setBindingName] = useState("分镜首帧工作流");
  const [inputContract, setInputContract] = useState<InputContract>({});
  const [outputNodeId, setOutputNodeId] = useState("");
  const [outputCollection, setOutputCollection] = useState("images");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [testInputs, setTestInputs] = useState<Record<string, TestInputValue>>({});
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testState, setTestState] = useState("");
  const [testProgress, setTestProgress] = useState(0);
  const [testFailed, setTestFailed] = useState(false);
  const [testNodeProgress, setTestNodeProgress] = useState<ExecutionProgress | null>(null);
  const [testResultUrl, setTestResultUrl] = useState<string | null>(null);
  const [testOutputCount, setTestOutputCount] = useState(0);
  const [testResultMediaType, setTestResultMediaType] = useState<"image" | "video" | "audio" | "json">("video");
  const [testRuns, setTestRuns] = useState<WorkflowTestRun[]>([]);
  const [testHistoryLoading, setTestHistoryLoading] = useState(false);
  const [editingBinding, setEditingBinding] = useState(false);

  const selected = capabilities.find((item) => item.key === selectedKey) ?? null;
  const isVideoTestCapability = selected?.outputs[0]?.mediaType === "video";
  const binding = resolveWorkflowBinding(bindings, selectedKey);
  const nodes = useMemo(() => Object.entries(workflow ?? {}), [workflow]);
  const bridgeWorkflowByName = useMemo(() => new Map(bridgeWorkflows.map((item) => [normalizedWorkflowName(item.name), item])), [bridgeWorkflows]);
  const availableLibraryWorkflows = useMemo(() => [...sparkWorkflows]
    .sort((a, b) => Number(capabilitySuggestionMatches(selectedKey, b.suggestedCapability)) - Number(capabilitySuggestionMatches(selectedKey, a.suggestedCapability)) || a.name.localeCompare(b.name, "zh-CN")), [selectedKey, sparkWorkflows]);
  const missingRequired = selected?.inputs.filter((input) => input.required && !inputContract[input.key]) ?? [];
  const mappedCount = selected?.inputs.filter((input) => Boolean(inputContract[input.key])).length ?? 0;
  const outputNodes = useMemo(() => workflowOutputNodeEntries(workflow, selected?.outputs[0]?.mediaType ?? "image"), [selected?.outputs, workflow]);
  const readyToSave = Boolean(workflow && missingRequired.length === 0 && (isMultiImagePackCapability(selectedKey) ? outputNodes.length > 0 : outputNodeId && outputCollection));
  const showBindingEditor = !binding || editingBinding;

  const refreshSparkWorkflows = useCallback(async () => {
    setSparkLoading(true);
    try {
      const response = await fetch("/api/workflows/spark-library", { cache: "no-store" });
      const data = await response.json() as { workflows?: SparkWorkflow[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Spark 工作流读取失败");
      setSparkWorkflows(data.workflows ?? []);
      setSelectedSparkName((current) => data.workflows?.some((item) => item.name === current) ? current : "");
      setNotice(`已读取 Spark 当前保存的 ${data.workflows?.length ?? 0} 个工作流`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Spark 工作流读取失败");
    } finally {
      setSparkLoading(false);
    }
  }, []);

  const refreshProductionReadiness = useCallback(async () => {
    const response = await fetch("/api/settings/readiness", { cache: "no-store" });
    if (!response.ok) return;
    const requirements = await response.json() as { mainline?: ProductionMainlineReadiness; capabilities?: WorkflowCapabilityInfo[] };
    setMainline(requirements.mainline ?? null);
    setCapabilities(requirements.capabilities ?? []);
  }, []);

  useEffect(() => {
    setActiveSection(initialSection);
    if (initialCapabilityKey) setSelectedKey(initialCapabilityKey);
  }, [initialCapabilityKey, initialSection]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/settings/readiness", { cache: "no-store" }),
      fetch("/api/settings/routing-rules", { cache: "no-store" }),
      fetch("/api/workflows/bindings", { cache: "no-store" }),
      fetch("/api/workflows/connection-test", { cache: "no-store" }),
      fetch("/api/workflows/bridge", { cache: "no-store" }),
    ]).then(async ([requirementsResponse, routingResponse, bindingsResponse, connectionResponse, bridgeResponse]) => {
      if (!requirementsResponse.ok || !bindingsResponse.ok) throw new Error("设置加载失败");
      const requirements = await requirementsResponse.json() as { mainline: ProductionMainlineReadiness; capabilities: WorkflowCapabilityInfo[] };
      const routingData = routingResponse.ok ? await routingResponse.json() as { rules?: ProductionRoutingRule[] } : { rules: [] };
      const savedBindings = await bindingsResponse.json() as { bindings: WorkflowBinding[] };
      const connectionResult = await connectionResponse.json() as ConnectionState;
      const bridgeResult = await bridgeResponse.json() as { bridge?: BridgeState; workflows?: BridgeWorkflow[] };
      if (cancelled) return;
      setMainline(requirements.mainline ?? null);
      setRoutingRules(routingData.rules ?? []);
      setCapabilities(requirements.capabilities);
      setBindings(savedBindings.bindings);
      setConnection(connectionResult);
      setBridge(bridgeResult.bridge ?? null);
      setBridgeWorkflows(bridgeResult.workflows ?? []);
      const current = savedBindings.bindings.find((item) => item.capability === "image_generation");
      const currentCapability = requirements.capabilities.find((item) => item.key === "image_generation") ?? null;
      setBindingName(current?.name ?? "通用图像生成工作流");
      setInputContract(current?.inputContract ?? {});
      setOutputNodeId(current?.outputContract.nodeId ?? "");
      setOutputCollection(current?.outputContract.output ?? "images");
      setTestInputs(defaultTestInputs(currentCapability));
    }).catch((error: unknown) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "设置加载失败"); });
    const refreshTimer = window.setTimeout(() => void refreshSparkWorkflows(), 0);
    return () => { cancelled = true; window.clearTimeout(refreshTimer); };
  }, [refreshSparkWorkflows]);

  useEffect(() => {
    if (!testRunId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const response = await fetch(`/api/workflows/test-runs/${testRunId}`, { cache: "no-store" });
      let data: { run?: { status: string; errorMessage?: string; progress?: ExecutionProgress | null; result?: { outputUrl?: string; durationSeconds?: number | null; mediaType?: "image" | "video" | "audio" | "json" } }; error?: { message?: string } };
      try {
        data = await readApiJson<typeof data>(response);
        if (!response.ok) throw new Error(data.error?.message ?? `测试状态读取失败（${response.status}）`);
      } catch (error) {
        if (cancelled) return;
        setTestRunId(null);
        setTestFailed(true);
        setTestState(`状态读取失败：${error instanceof Error ? error.message : "请重试"}`);
        return;
      }
      if (cancelled || !data.run) return;
      if (data.run.progress?.source === "bridge") {
        setTestNodeProgress(data.run.progress);
        setTestProgress(data.run.progress.overall);
        setTestState(data.run.progress.stage);
      }
      if (["submitting", "queued", "running"].includes(data.run.status)) {
        if (!data.run.progress) {
          const waitingHint = isVideoTestCapability
            ? "LTX 图生视频仍在执行（桥接器未上报节点进度）。若长时间无变化，请到 ComfyUI 看队列是否卡住，并确认桥接密钥一致。"
            : data.run.status === "running"
              ? "Spark 正在执行工作流（桥接器未上报节点进度）…"
              : "任务已进入 Spark 队列…";
          setTestState(waitingHint);
          setTestProgress(data.run.status === "running" ? 72 : 42);
        }
        setTestFailed(false);
        timer = window.setTimeout(poll, 1800);
        return;
      }
      setTestRunId(null);
      void refreshProductionReadiness();
      if (data.run.status === "succeeded" && data.run.result?.outputUrl) {
        setTestResultUrl(`${data.run.result.outputUrl}?t=${Date.now()}`);
        setTestOutputCount(Math.max(1, Number(data.run.result.outputCount) || 1));
        setTestResultMediaType(data.run.result.mediaType ?? selected?.outputs[0]?.mediaType ?? "video");
        setTestState(data.run.result.durationSeconds
          ? `测试成功，已生成 ${data.run.result.durationSeconds.toFixed(2)} 秒视频`
          : data.run.result.outputCount && data.run.result.outputCount > 1
            ? `测试成功，共收集 ${data.run.result.outputCount} 张输出图`
            : "测试成功，工作流可以用于正式创作");
        setTestProgress(100);
        setTestNodeProgress((current) => current ? { ...current, overall: 100, stage: "结果已返回" } : null);
        setTestFailed(false);
      } else {
        setTestState(`测试失败：${describeTestError(data.run.errorMessage)}`);
        setTestFailed(true);
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refreshProductionReadiness, selected?.outputs, testRunId]);

  const loadTestRuns = async (bindingId: string) => {
    setTestHistoryLoading(true);
    try {
      const response = await fetch(`/api/workflows/bindings/${bindingId}/test`, { cache: "no-store" });
      const data = await readApiJson<{ runs?: WorkflowTestRun[]; error?: { message?: string } }>(response);
      if (!response.ok) throw new Error(data.error?.message ?? "测试记录读取失败");
      const runs = data.runs ?? [];
      setTestRuns(runs);
      const latest = runs[0];
      if (!latest) {
        setTestState("");
        setTestProgress(0);
        setTestFailed(false);
        setTestResultUrl(null);
        setTestOutputCount(0);
      } else if (["submitting", "queued", "running"].includes(latest.status)) {
        setTestRunId(latest.id);
        setTestState(latest.status === "running" ? "Spark 正在执行工作流…" : "任务已进入 Spark 队列…");
        setTestProgress(latest.status === "running" ? 72 : 42);
        setTestFailed(false);
      } else if (latest.status === "succeeded" && latest.result?.outputUrl) {
        setTestOutputCount(Math.max(1, Number(latest.result.outputCount) || 1));
        setTestState(latest.result.durationSeconds
          ? `最近一次测试成功，视频时长 ${latest.result.durationSeconds.toFixed(2)} 秒`
          : latest.result.outputCount && latest.result.outputCount > 1
            ? `最近一次测试成功，共 ${latest.result.outputCount} 张输出图`
            : "最近一次测试成功，可直接查看结果");
        setTestProgress(100);
        setTestFailed(false);
        setTestResultUrl(latest.result.outputUrl);
        setTestResultMediaType(latest.result.mediaType ?? "video");
      } else {
        setTestState(`最近一次测试失败：${describeTestError(latest.errorMessage)}`);
        setTestProgress(0);
        setTestFailed(true);
        setTestResultUrl(null);
      }
    } catch (error) {
      setTestState(error instanceof Error ? error.message : "测试记录读取失败");
      setTestFailed(true);
    } finally {
      setTestHistoryLoading(false);
    }
  };

  const chooseCapability = (key: string) => {
    const current = resolveWorkflowBinding(bindings, key);
    const definition = capabilities.find((item) => item.key === key);
    setSelectedKey(key);
    setBindingName(current?.name ?? `${definition?.name ?? "生成"}工作流`);
    setInputContract(current?.inputContract ?? {});
    setOutputNodeId(current?.outputContract.nodeId ?? "");
    setOutputCollection(current?.outputContract.output ?? defaultOutputCollection(definition?.outputs[0]?.mediaType ?? "image"));
    setWorkflow(null);
    setWorkflowFileName("");
    setSelectedSparkName("");
    setSelectedBridgeWorkflow(null);
    setNotice("");
    setEditingBinding(!current);
    setTestInputs(defaultTestInputs(definition ?? null));
    setTestRunId(null);
    setTestState("");
    setTestProgress(0);
    setTestFailed(false);
    setTestNodeProgress(null);
    setTestResultUrl(null);
    setTestRuns([]);
    if (current) void loadTestRuns(current.id);
  };

  const chooseSection = (key: SettingsSection) => {
    setActiveSection(key);
    if (key === "image") chooseCapability("image_generation");
    else if (key === "video") chooseCapability("image_to_video");
    else if (key === "audio") chooseCapability("voice_synthesis");
  };

  const focusMainlineStage = (stage: MainlineStage) => {
    if (stage.settingsSection) setActiveSection(stage.settingsSection as SettingsSection);
    if (stage.capability) chooseCapability(stage.capability);
  };

  const sectionCapabilities = useMemo(() => {
    if (!["image", "video", "audio"].includes(activeSection)) return [];
    const ordered = orderedSettingsCapabilities(activeSection as "image" | "video" | "audio");
    return ordered.map((definition) => {
      const runtime = capabilities.find((item) => item.key === definition.key);
      return runtime ?? { ...definition, configured: false, verified: false, latestTestStatus: null, bindingName: null, bindingId: null };
    });
  }, [activeSection, capabilities]);

  const applyWorkflow = (document: WorkflowDocument, fileName: string, capability: WorkflowCapabilityInfo) => {
    let suggestions = suggestInputContract(document, capability);
    if (capability.key === "character_image") suggestions = preferCharacterImageContract(document, suggestions);
    if (capability.key === "multi_character_storyboard" || capability.key === "storyboard_frame") {
      suggestions = preferStoryboardReferenceContract(document, suggestions);
    }
    const suggestedOutput = isMultiImagePackCapability(capability.key)
      ? buildMultiImageOutputContract(document).nodeId
      : suggestOutputNode(document, capability.outputs[0].mediaType);
    const missing = capability.inputs.filter((input) => input.required && !suggestions[input.key]);
    setWorkflow(document);
    setWorkflowFileName(fileName);
    setInputContract(suggestions);
    setOutputNodeId(suggestedOutput);
    setOutputCollection(isMultiImagePackCapability(capability.key) ? "images" : defaultOutputCollection(capability.outputs[0].mediaType));
    setBindingName(`${capability.name} · ${fileName.replace(/\.json$/i, "")}`);
    setNotice(missing.length ? `已自动完成部分映射，还需确认：${missing.map((item) => item.label).join("、")}` : suggestedOutput ? "输入和输出已自动识别，请确认后保存" : "输入已识别，请选择最终输出节点");
  };

  const uploadWorkflow = async (file: File | undefined) => {
    if (!file || !selected) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isApiWorkflow(parsed)) throw new Error("这是可视化工作流，请在 ComfyUI 中导出「API 格式」后再上传");
      setSelectedSparkName("");
      setSelectedBridgeWorkflow(null);
      applyWorkflow(parsed, file.name, selected);
    } catch (error) {
      setWorkflow(null);
      setWorkflowFileName("");
      setNotice(error instanceof Error ? error.message : "工作流读取失败");
    }
  };

  const selectLibraryWorkflow = async (item: SparkWorkflow) => {
    const targetCapability = selected;
    if (!targetCapability) return;
    setEditingBinding(true);
    setSelectedSparkName(item.name);
    const existingBridgeWorkflow = bridgeWorkflowByName.get(normalizedWorkflowName(item.name));
    if (existingBridgeWorkflow) {
      setSelectedBridgeWorkflow(existingBridgeWorkflow);
      setWorkflow(null);
      setNotice(`正在读取“${item.name.replace(/\.json$/i, "")}”的固定执行版本…`);
      try {
        const response = await fetch(`/api/workflows/bridge?workflowId=${encodeURIComponent(existingBridgeWorkflow.id)}&version=${encodeURIComponent(existingBridgeWorkflow.latestVersion)}`, { cache: "no-store" });
        const data = await response.json() as { api?: unknown; error?: { message?: string } };
        if (!response.ok || !isApiWorkflow(data.api)) throw new Error(data.error?.message ?? "桥接工作流读取失败");
        applyWorkflow(data.api, item.name, targetCapability);
        setNotice(`已选择 ComfyUI 工作流“${item.name.replace(/\.json$/i, "")}”，确认创作字段后即可启用`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "桥接工作流读取失败");
      }
      return;
    }
    if (!bridge?.authorized) {
      setNotice("小飞象桥接器尚未连接，无法把可视化工作流转换为执行版");
      return;
    }
    setPreparingWorkflowName(item.name);
    setSelectedBridgeWorkflow(null);
    setWorkflow(null);
    setNotice(`正在通知 ComfyUI 准备“${item.name.replace(/\.json$/i, "")}”…请保持 ComfyUI 页面打开`);
    try {
      const startResponse = await fetch("/api/workflows/bridge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: item.name }),
      });
      const startData = await startResponse.json() as { preparation?: WorkflowPreparation; error?: { message?: string } };
      if (!startResponse.ok || !startData.preparation) throw new Error(startData.error?.message ?? "无法准备工作流");
      let prepared: PreparedWorkflowResponse | null = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const statusResponse = await fetch(`/api/workflows/bridge?preparationId=${encodeURIComponent(startData.preparation.id)}`, { cache: "no-store" });
        const statusData = await statusResponse.json() as PreparedWorkflowResponse;
        prepared = statusData;
        if (!statusResponse.ok) throw new Error(statusData.error?.message ?? "工作流同步状态读取失败");
        if (prepared?.preparation?.status === "failed") throw new Error(prepared.preparation.error ?? "ComfyUI 无法生成执行版");
        if (prepared?.preparation?.status === "succeeded") break;
        setNotice(prepared?.preparation?.status === "preparing" ? "ComfyUI 正在读取工作流并生成执行版…" : "已提交，正在等待 ComfyUI 页面响应…");
      }
      if (prepared?.preparation?.status !== "succeeded" || !prepared.workflow || !isApiWorkflow(prepared.api)) {
        throw new Error("等待 ComfyUI 响应超时，请确认 ComfyUI 页面已刷新并保持打开");
      }
      setBridgeWorkflows((current) => [prepared!.workflow!, ...current.filter((workflowItem) => workflowItem.id !== prepared!.workflow!.id)]);
      setSelectedBridgeWorkflow(prepared.workflow);
      applyWorkflow(prepared.api, item.name, targetCapability);
      setNotice(`已从 ComfyUI 取得“${item.name.replace(/\.json$/i, "")}”的执行版，确认创作字段后即可启用`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作流准备失败");
    } finally {
      setPreparingWorkflowName("");
    }
  };

  const mapInput = (key: string, value: string) => {
    setInputContract((current) => {
      const next = { ...current };
      if (!value) delete next[key];
      else {
        const [nodeId, input] = value.split("::");
        next[key] = { nodeId, input };
      }
      return next;
    });
  };

  const cancelEditingBinding = () => {
    if (!binding || !selected) {
      setEditingBinding(false);
      return;
    }
    setEditingBinding(false);
    setBindingName(binding.name);
    setInputContract(binding.inputContract);
    setOutputNodeId(binding.outputContract.nodeId);
    setOutputCollection(binding.outputContract.output);
    setWorkflow(null);
    setWorkflowFileName("");
    setSelectedSparkName("");
    setSelectedBridgeWorkflow(null);
    setNotice("");
  };

  const startReplaceBinding = async () => {
    if (!binding || !selected) return;
    setEditingBinding(true);
    setBindingName(binding.name);
    setInputContract(binding.inputContract);
    setOutputNodeId(binding.outputContract.nodeId);
    setOutputCollection(binding.outputContract.output);
    const bridgeMatch = bridgeWorkflows.find((item) => item.id === binding.sourceWorkflowId)
      ?? [...bridgeWorkflowByName.values()].find((item) => normalizedWorkflowName(item.name) === normalizedWorkflowName(binding.name));
    if (!binding.sourceWorkflowId && !bridgeMatch) {
      setWorkflow(null);
      setSelectedSparkName("");
      setSelectedBridgeWorkflow(null);
      setNotice("请从 Spark 选择或上传新的 API 执行版");
      return;
    }
    setNotice("正在加载当前工作流…");
    try {
      const workflowId = bridgeMatch?.id ?? binding.sourceWorkflowId!;
      const version = binding.sourceVersion ?? bridgeMatch?.latestVersion;
      const response = await fetch(`/api/workflows/bridge?workflowId=${encodeURIComponent(workflowId)}${version ? `&version=${encodeURIComponent(version)}` : ""}`, { cache: "no-store" });
      const data = await response.json() as { api?: unknown; error?: { message?: string } };
      if (!response.ok || !isApiWorkflow(data.api)) throw new Error(data.error?.message ?? "当前工作流读取失败");
      setWorkflow(data.api);
      setSelectedBridgeWorkflow(bridgeMatch ?? null);
      setSelectedSparkName(bridgeMatch?.name ?? binding.name);
      setNotice("已加载当前绑定，可直接修改字段映射，或从上方更换其他工作流");
    } catch (error) {
      setWorkflow(null);
      setSelectedSparkName("");
      setSelectedBridgeWorkflow(null);
      setNotice(error instanceof Error ? error.message : "当前工作流读取失败，请重新选择");
    }
  };

  const save = async () => {
    if (!selected || !workflow || !readyToSave) {
      setNotice(missingRequired.length ? `还需要映射：${missingRequired.map((item) => item.label).join("、")}` : "请先准备可执行工作流并确认输出节点");
      return;
    }
    setSaving(true);
    setNotice("正在校验并保存工作流…");
    try {
      const response = await fetch("/api/workflows/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: selected.key,
          name: bindingName,
          workflow: selectedBridgeWorkflow ? undefined : workflow,
          bridgeWorkflowId: selectedBridgeWorkflow?.id,
          bridgeVersion: selectedBridgeWorkflow?.latestVersion,
          inputContract,
          outputContract: isMultiImagePackCapability(selected.key) && workflow
            ? buildMultiImageOutputContract(workflow)
            : { nodeId: outputNodeId, output: outputCollection, mediaType: selected.outputs[0].mediaType } satisfies OutputContract,
          enabled: true,
        }),
      });
      const data = await response.json() as { binding?: WorkflowBinding; error?: { message?: string } };
      if (!response.ok || !data.binding) throw new Error(data.error?.message ?? "工作流保存失败");
      setBindings((current) => [...current.filter((item) => item.capability !== data.binding?.capability), data.binding!]);
      setCapabilities((current) => current.map((item) => item.key === selected.key ? { ...item, configured: true, verified: false, latestTestStatus: "invalidated", bindingId: data.binding!.id, bindingName: data.binding!.name } : item));
      await refreshProductionReadiness();
      setEditingBinding(false);
      setWorkflow(null);
      setWorkflowFileName("");
      setNotice("执行版已保存；请在下方完成一次真实测试，通过后才会进入短剧生产方案");
      void loadTestRuns(data.binding.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作流保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveRoutingRules = async () => {
    setRoutingSaving(true);
    setNotice("正在保存路由规则…");
    try {
      const response = await fetch("/api/settings/routing-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: routingRules }),
      });
      const data = await response.json() as { rules?: ProductionRoutingRule[]; error?: { message?: string } };
      if (!response.ok || !data.rules) throw new Error(data.error?.message ?? "路由规则保存失败");
      setRoutingRules(data.rules);
      setNotice("路由规则已保存");
      await refreshProductionReadiness();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "路由规则保存失败");
    } finally {
      setRoutingSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    const [connectionResponse, bridgeResponse] = await Promise.all([
      fetch("/api/workflows/connection-test", { cache: "no-store" }),
      fetch("/api/workflows/bridge", { cache: "no-store" }),
    ]);
    setConnection(await connectionResponse.json() as ConnectionState);
    const bridgeResult = await bridgeResponse.json() as { bridge?: BridgeState; workflows?: BridgeWorkflow[] };
    setBridge(bridgeResult.bridge ?? null);
    setBridgeWorkflows(bridgeResult.workflows ?? []);
    setTesting(false);
  };

  const startWorkflowTest = async () => {
    if (!binding || !selected) {
      setTestState("请先绑定并启用工作流");
      return;
    }
    const missingTestInputs = selected.inputs.filter((input) => input.required && isTestInputMissing(input, testInputs[input.key], selected.key));
    if (missingTestInputs.length) {
      const needsMoreRefs = selected.key === "multi_reference_image" && Array.isArray(testInputs.referenceImages) && testInputs.referenceImages.length === 1;
      setTestState(needsMoreRefs ? "多参考图生图至少需要 2 张参考图，请继续添加" : `请填写：${missingTestInputs.map((item) => item.label).join("、")}`);
      setTestProgress(0);
      setTestFailed(true);
      return;
    }
    const oversized = selected.inputs.find((input) => {
      const value = testInputs[input.key];
      if (Array.isArray(value)) return value.some((file) => file instanceof File && file.size > MAX_TEST_FRAME_BYTES);
      return value instanceof File && value.size > MAX_TEST_FRAME_BYTES;
    });
    if (oversized) {
      setTestState(`提交失败：${oversized.label}不能超过 15 MB`);
      setTestProgress(0);
      setTestFailed(true);
      return;
    }
    setTestResultUrl(null);
    setTestState("正在提交测试输入…");
    setTestProgress(8);
    setTestNodeProgress(null);
    setTestFailed(false);
    try {
      const form = new FormData();
      form.append("_capability", selected.key);
      selected.inputs.forEach((input) => {
        const value = testInputs[input.key];
        if (Array.isArray(value)) value.forEach((file) => { if (file instanceof File) form.append(input.key, file); });
        else if (value instanceof File) form.append(input.key, value);
        else if (typeof value === "boolean") form.append(input.key, String(value));
        else if (typeof value === "string" && value.trim()) form.append(input.key, value);
      });
      const response = await fetch(`/api/workflows/bindings/${binding.id}/test`, { method: "POST", body: form });
      const data = await readApiJson<{ run?: { id: string }; error?: { message?: string; details?: { reason?: string } } }>(response);
      if (!response.ok || !data.run) throw new Error(data.error?.details?.reason ?? data.error?.message ?? "无法启动测试");
      setTestRunId(data.run.id);
      setTestState(isVideoTestCapability
        ? "任务已提交。LTX 会自动锁定首帧角色并补动作描述，通常需要 10–30 分钟。"
        : "任务已提交，正在等待 Spark…");
      setTestProgress(40);
    } catch (error) {
      setTestState(`提交失败：${error instanceof Error ? error.message : "无法启动测试"}`);
      setTestProgress(8);
      setTestFailed(true);
    }
  };

  return (
    <div className="modal-backdrop settings-modal-backdrop" onMouseDown={onClose}>
      <div className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-modal-header">
          <div><p className="eyebrow">设置</p><h2>创作主线能力配置</h2></div>
          <button type="button" className="settings-close" onClick={onClose}>×</button>
        </header>
        <div className="settings-modal-body">
        <div className={`settings-layout ${(["image", "video", "audio"] as const).includes(activeSection as "image" | "video" | "audio") ? "has-submenu" : ""}`}>
          <aside className="settings-nav settings-primary">
            <p className="settings-nav-heading">主线步骤</p>
            {settingsMenuSections.map((item) => <button key={item.key} type="button" className={`settings-nav-item ${activeSection === item.key ? "active" : ""}`} onClick={() => chooseSection(item.key)}><span>{item.step}</span><div><b>{item.label}</b></div></button>)}
          </aside>

          {(["image", "video", "audio"] as const).includes(activeSection as "image" | "video" | "audio") && (
            <nav className="settings-submenu-panel" aria-label="能力项">
              <div className="settings-submenu-heading">能力项</div>
              {sectionCapabilities.map((item) => <button key={item.key} type="button" className={`settings-submenu-item ${selectedKey === item.key ? "active" : ""}`} onClick={() => chooseCapability(item.key)}><span>{item.verified ? "✓" : item.configured ? "◐" : "·"}</span><div><b>{item.name}</b></div></button>)}
            </nav>
          )}

          <main className="settings-content">
            {(["text", "comfyui", "edit"] as const).includes(activeSection as "text" | "comfyui" | "edit") && (
              <EngineConnectionsPanel
                section={activeSection}
                onReadinessChanged={() => void refreshProductionReadiness()}
                bridge={bridge}
                connection={connection}
                bridgeWorkflowCount={bridgeWorkflows.length}
                testingComfy={testing}
                onTestComfy={() => void testConnection()}
              />
            )}

            {activeSection === "readiness" && <section className={`production-mainline-readiness ${mainline?.ready ? "ready" : ""}`}>
          <div className="mainline-readiness-heading"><div><p className="eyebrow">主线就绪</p><h2>{mainline?.ready ? "必需阶段已就绪" : "按步骤补齐缺失能力"}</h2></div><div><b>{mainline?.readyRequired ?? 0}/{mainline?.requiredTotal ?? 8}</b><span>必需阶段已就绪</span></div></div>
          <div className="mainline-stage-list">{mainline?.stages.map((stage) => <article key={stage.key} className={stage.status}><i>{stage.status === "ready" ? "✓" : stage.step}</i><div><span>{stage.required ? `第 ${stage.step} 步` : "可选"}</span><b>{stage.name}</b><p>{stage.missingItems.length ? stage.missingItems.join("、") : "已就绪"}</p></div><em>{stage.status === "ready" ? "已验证" : stage.status === "needs_test" ? "需要真实测试" : stage.status === "optional" ? "尚未配置" : "需要配置"}</em>{stage.actionLabel && <button type="button" onClick={() => focusMainlineStage(stage)}>{stage.actionLabel} →</button>}</article>)}</div>
        </section>}

        {activeSection === "routing" && <section className="workflow-section">
          {routingRuleGroups.map((group) => {
            const rules = routingRules.filter((rule) => group.ruleKeys.includes(rule.ruleKey));
            if (!rules.length) return null;
            return <div key={group.key} className="settings-routing-group">
              <div className="workflow-section-title"><b>{group.title}</b><span>{group.description}</span></div>
              <div className="production-route-strategies">{rules.map((rule) => <div key={rule.ruleKey} className={rule.enabled ? "ready" : ""}><i>{rule.enabled ? "✓" : "·"}</i><div><b>{rule.name}</b><p>{rule.ruleKey}</p><label><span>目标能力</span><select value={rule.targetCapability} onChange={(event) => setRoutingRules((current) => current.map((item) => item.ruleKey === rule.ruleKey ? { ...item, targetCapability: event.target.value as ProductionRoutingRule["targetCapability"] } : item))}>{workflowCapabilities.filter((item) => item.mediaDomain === "video" || item.key === "voice_synthesis" || item.key === "lip_sync").map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><label className="test-boolean"><span>启用</span><input type="checkbox" checked={rule.enabled} onChange={(event) => setRoutingRules((current) => current.map((item) => item.ruleKey === rule.ruleKey ? { ...item, enabled: event.target.checked } : item))} /></label></div></div>)}</div>
            </div>;
          })}
          <div className="workflow-savebar"><div>{notice && activeSection === "routing" && <p>{notice}</p>}</div><AppButton primary onClick={() => void saveRoutingRules()} disabled={routingSaving}>{routingSaving ? "保存中…" : "保存路由规则"}</AppButton></div>
        </section>}

        {(["image", "video", "audio"].includes(activeSection)) && selected && <>
              {binding && !editingBinding && <section className="settings-capability-panel">
                <header className="settings-capability-header">
                  <div>
                    <div className="settings-capability-title-row">
                      <h2>{selected.name}</h2>
                      <span className={`settings-status-badge ${testRunId ? "pending" : selected.verified ? "verified" : selected.configured ? "pending" : "empty"}`}>{testRunId ? "测试中" : selected.verified ? "已验证" : selected.configured ? "待测试" : "未配置"}</span>
                    </div>
                    <p>{selected.requirement}</p>
                  </div>
                  <AppButton onClick={() => void startReplaceBinding()}>更换工作流</AppButton>
                </header>

                {binding && <div className="settings-capability-meta">
                  <div><span>绑定工作流</span><b>{binding.name}</b></div>
                  <div><span>输入</span><b>{selected.inputs.filter((input) => binding.inputContract[input.key]).map((input) => input.label).join(" · ") || "未映射"}</b></div>
                  <div><span>输出</span><b>{isMultiImagePackCapability(selected.key) || binding.outputContract.collectAllImages ? "标准图包 · 全部 SaveImage" : binding.outputContract.mediaType === "video" ? "视频" : binding.outputContract.mediaType === "audio" ? "音频" : "单图"}</b></div>
                  <div><span>最近测试</span><b className={!testRunId && testRuns[0]?.status === "succeeded" ? "healthy" : ""}>{testRunId || testRuns[0]?.status === "running" || testRuns[0]?.status === "queued" ? "执行中" : testRuns[0]?.status === "succeeded" ? "通过" : selected.configured ? "未完成" : "—"}</b></div>
                </div>}

                <div className="settings-capability-test">
                  <div className="settings-capability-test-head">
                    <b>真实测试</b>
                    <span>只验证工作流，不会写入项目资产</span>
                  </div>
                  <div className={`settings-test-status ${testFailed ? "failed" : ""} ${testRunId ? "running" : ""}`} aria-live="polite">
                    <div className="settings-test-status-row">
                      <b>{testHistoryLoading ? "正在恢复测试记录…" : testState || "填写下方输入后开始测试"}</b>
                      <span>{testProgress > 0 ? `${testProgress}%` : ""}</span>
                    </div>
                    {(testProgress > 0 || testRunId) && <div className="test-progress-track"><i style={{ width: `${testProgress}%` }} /></div>}
                    {testNodeProgress && <p className="settings-test-node-line">{testNodeProgress.currentNodeTitle ?? "执行中"} · {testNodeProgress.completedNodes}/{testNodeProgress.totalNodes} 节点</p>}
                  </div>
                  <div className="settings-test-layout">
                    <div className="settings-test-form">
                      {selected.inputs.map((input) => {
                        const value = testInputs[input.key];
                        if (input.valueType === "imageList") {
                          const files = Array.isArray(value) ? value.filter((item): item is File => item instanceof File) : [];
                          return <TestImageListField key={input.key} input={input} files={files} capabilityKey={selected.key} onChange={(next) => { setTestInputs((current) => ({ ...current, [input.key]: next })); setTestFailed(false); setTestProgress(0); }} onStatus={setTestState} />;
                        }
                        if (["image", "video", "audio"].includes(input.valueType)) {
                          const file = value instanceof File ? value : null;
                          const accept = input.valueType === "image" ? "image/*" : input.valueType === "video" ? "video/*" : "audio/*";
                          return <label key={input.key} className={`settings-test-upload ${file ? "selected" : ""}`}><input type="file" accept={accept} onChange={(event) => { const next = event.target.files?.[0] ?? null; setTestInputs((current) => ({ ...current, [input.key]: next })); setTestFailed(false); setTestProgress(0); setTestState(next ? `${input.label}已选择` : ""); }} /><span>{file ? "✓" : "＋"}</span><div><b>{input.label}</b><small>{file ? file.name : `${input.required ? "必填" : "可选"}，最大 15 MB`}</small></div></label>;
                        }
                        if (input.valueType === "boolean") {
                          if (selected.key === "image_to_video" && input.key === "promptEnhance") {
                            return <p key={input.key} className="settings-test-note">LTX 图生视频会自动锁定首帧角色并补动作约束，请勿开启 Gemma 扩写（容易换脸换场景）。</p>;
                          }
                          return <label key={input.key} className="settings-test-boolean"><span>{input.label}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => setTestInputs((current) => ({ ...current, [input.key]: event.target.checked }))} /></label>;
                        }
                        if (input.valueType === "number") {
                          return <label key={input.key} className="settings-test-field"><span>{input.label}</span><input type="number" min={0} value={typeof value === "string" ? value : ""} onChange={(event) => setTestInputs((current) => ({ ...current, [input.key]: event.target.value }))} /></label>;
                        }
                        return <label key={input.key} className="settings-test-field"><span>{input.label}</span><textarea value={typeof value === "string" ? value : ""} placeholder={input.key === "prompt" && selected.key === "image_to_video" ? "例：开心蹦跳并向镜头招手，身体有明显上下起伏" : `请输入${input.label}`} onChange={(event) => setTestInputs((current) => ({ ...current, [input.key]: event.target.value }))} /></label>;
                      })}
                      <AppButton primary disabled={Boolean(testRunId)} onClick={startWorkflowTest}>{testRunId ? "Spark 执行中…" : "开始测试"}</AppButton>
                    </div>
                    <div className={`settings-test-result ${testResultUrl ? "has-result" : ""} ${testRunId ? "running" : ""}`}>
                      {testResultUrl && testResultMediaType === "image" && testOutputCount > 1 ? <div className="test-image-pack-result"><div className="test-image-pack-heading"><b>共 {testOutputCount} 张</b><span>标准图包预览</span></div><div className="test-image-pack-grid">{Array.from({ length: testOutputCount }, (_, index) => <Image key={index} unoptimized width={160} height={160} src={`${testResultUrl!.split("?")[0]}?index=${index}&t=${Date.now()}`} alt={`测试结果 ${index + 1}`} />)}</div></div>
                        : testResultUrl && testResultMediaType === "video" ? <video controls src={testResultUrl} />
                        : testResultUrl && testResultMediaType === "audio" ? <div className="test-audio-result"><b>音频已生成</b><audio controls src={testResultUrl} /></div>
                        : testResultUrl && testResultMediaType === "image" ? <Image unoptimized width={640} height={480} src={testResultUrl} alt="测试结果" />
                        : testRunId ? <div className="settings-test-running"><b>{isMultiImagePackCapability(selected.key) ? "正在生成标准图包…" : "Spark 正在执行…"}</b><p>{isMultiImagePackCapability(selected.key) ? "完成后会显示全部 SaveImage 输出" : "完成后会在这里显示结果"}</p></div>
                        : <div className="settings-test-empty"><span>预览区</span><p>测试成功后显示输出{isMultiImagePackCapability(selected.key) ? "（多图）" : ""}</p></div>}
                    </div>
                  </div>
                  {testRuns.length > 0 && <div className="settings-test-history">{testRuns.slice(0, 3).map((run) => <div key={run.id}><i className={run.status}>{run.status === "succeeded" ? "✓" : run.status === "failed" ? "!" : "…"}</i><span>{run.status === "succeeded" ? run.result?.outputCount && run.result.outputCount > 1 ? `成功 · ${run.result.outputCount} 张` : "成功" : run.status === "failed" ? "失败" : run.status === "invalidated" ? "需重测" : "执行中"}</span><time>{new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>)}</div>}
                </div>
              </section>}

              {showBindingEditor && <div className="settings-binding-editor">

              {binding && editingBinding && <section className="settings-binding-editor-header">
                <div>
                  <p className="eyebrow">更换工作流</p>
                  <h3>{selected.name}</h3>
                  <p>{isMultiImagePackCapability(selected.key) ? "确认 PROMPT 与参考图映射；生产会归档全部 SaveImage 输出（三视图、表情、姿势等）" : "选择 Spark 工作流并确认字段映射"}</p>
                </div>
                <AppButton onClick={cancelEditingBinding}>取消</AppButton>
              </section>}

              <section className="workflow-section spark-library-section">
                <div className="workflow-section-title"><b>1. 选择 ComfyUI 工作流</b><span>{availableLibraryWorkflows.length} 个可用 · 同一工作流可用于多个兼容方案</span><AppButton onClick={() => void refreshSparkWorkflows()} disabled={sparkLoading}>{sparkLoading ? "读取中…" : "刷新列表"}</AppButton></div>
                <label className="workflow-picker"><span>工作流</span><select value={selectedSparkName} disabled={sparkLoading || Boolean(preparingWorkflowName)} onChange={(event) => { const item = sparkWorkflows.find((workflowItem) => workflowItem.name === event.target.value); if (item) void selectLibraryWorkflow(item); }}><option value="">{sparkLoading ? "正在读取 ComfyUI 工作流…" : "请选择工作流"}</option>{availableLibraryWorkflows.map((item) => <option key={item.name} value={item.name}>{item.name.replace(/\.json$/i, "")}</option>)}</select><small>{preparingWorkflowName ? `正在准备“${preparingWorkflowName.replace(/\.json$/i, "")}”…` : "选择后自动读取执行版并识别输入、输出字段"}</small></label>
                {!sparkLoading && !availableLibraryWorkflows.length && <div className="workflow-empty">没有可用于当前能力的工作流</div>}
                {!bridge?.authorized && <div className="format-guidance"><span>!</span><div><b>{bridge?.installed ? "桥接器已安装，但小飞象与 ComfyUI 的密钥不一致" : "Spark 尚未安装小飞象工作流桥接器"}</b><p>列表可以读取，但选择可视化工作流时需要桥接器生成可执行版本。</p></div>{connection?.serverUrl && <a href={connection.serverUrl} target="_blank" rel="noreferrer">打开 ComfyUI ↗</a>}</div>}
                <details className="compat-workflow-source"><summary>备用方式：上传 API 格式 JSON</summary><label className={`workflow-dropzone ${workflow && !selectedBridgeWorkflow ? "has-file" : ""}`}><input type="file" accept="application/json,.json" onChange={(event) => void uploadWorkflow(event.target.files?.[0])} /><strong>{workflow && !selectedBridgeWorkflow ? "✓" : "＋"}</strong><div><b>{workflow && !selectedBridgeWorkflow ? workflowFileName : "上传 API 格式 JSON"}</b><span>仅用于 ComfyUI 页面无法保持打开的特殊情况</span></div></label></details>
              </section>

              <section className={`workflow-section ${workflow ? "" : "section-disabled"}`}>
                <div className="workflow-section-title"><b>2. 确认创作字段</b><span>{workflow ? `${mappedCount}/${selected.inputs.length} 项已识别` : "选择工作流后自动出现"}</span></div>
                <div className="contract-grid">{selected.inputs.map((input) => {
                  const current = inputContract[input.key];
                  const value = current ? `${current.nodeId}::${current.input}` : "";
                  return <label key={input.key} className={current ? "mapped" : input.required ? "missing" : ""}><span>{input.label}{input.required && <i>*</i>}<small>{current ? "已自动识别" : input.required ? "需要确认" : "可选"}</small></span><select value={value} disabled={!workflow} onChange={(event) => mapInput(input.key, event.target.value)}><option value="">{workflow ? "选择对应输入" : "等待识别"}</option>{nodes.flatMap(([nodeId, node]) => Object.keys(node.inputs ?? {}).map((inputName) => <option key={`${nodeId}-${inputName}`} value={`${nodeId}::${inputName}`}>{nodeLabel(nodeId, node)} / {inputName}</option>))}</select></label>;
                })}</div>
              </section>

              <section className={`workflow-section ${workflow ? "" : "section-disabled"}`}>
                <div className="workflow-section-title"><b>3. 确认生成结果</b><span>{isMultiImagePackCapability(selected.key) ? "自动收集工作流内全部 SaveImage 输出" : "完成后自动回到对应资产或分镜"}</span></div>
                {isMultiImagePackCapability(selected.key) ? <div className="settings-output-pack">
                  <div className="settings-output-pack-note"><b>多图输出 · 自动收集</b><p>这个工作流一次会产出多张图（三视图、表情、姿势等）。保存后，生产和测试都会自动归档全部 SaveImage 节点{workflow ? `，当前识别到 ${outputNodes.length} 个` : ""}。</p></div>
                </div> : <div className="output-contract guided-output"><label><span>最终输出</span><select value={outputNodeId} disabled={!workflow} onChange={(event) => setOutputNodeId(event.target.value)}><option value="">选择最终输出节点</option>{outputNodes.map(([nodeId, node]) => <option key={nodeId} value={nodeId}>{nodeLabel(nodeId, node)}</option>)}</select></label><div><span>归档位置</span><b>{selected.outputs[0].label} · 自动归档</b></div><details><summary>高级设置</summary><label>结果字段<input value={outputCollection} disabled={!workflow} onChange={(event) => setOutputCollection(event.target.value)} /></label></details></div>}
              </section>

              <div className="workflow-savebar settings-workflow-savebar"><div><label>配置名称<input value={bindingName} onChange={(event) => setBindingName(event.target.value)} /></label>{notice && <p>{notice}</p>}</div><AppButton primary onClick={save} disabled={saving || !readyToSave}>{saving ? "保存中…" : binding ? "保存更新并重测" : "保存绑定并测试"}</AppButton></div>
              </div>}
            </>}
          </main>
        </div>
        </div>
      </div>
    </div>
  );
}
