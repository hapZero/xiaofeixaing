"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import type { View, WorkflowCapabilityInfo, WorkflowInputDefinition } from "../studio/types";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
type WorkflowDocument = Record<string, WorkflowNode>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
type WorkflowBinding = { id: string; capability: string; name: string; sourceType?: string; sourceWorkflowId?: string | null; sourceVersion?: string | null; inputContract: InputContract; outputContract: OutputContract; enabled: boolean };
type ExecutionProgress = { source: "bridge"; overall: number; stage: string; currentNodeId: string | null; currentNodeTitle: string | null; nodeValue: number | null; nodeMax: number | null; completedNodes: number; totalNodes: number; cachedNodes: number; lastSequence: number };
type WorkflowTestRun = {
  id: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string | number | Date;
  result?: { outputUrl?: string; durationSeconds?: number | null } | null;
};
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
type BridgeWorkflow = { id: string; name: string; latestVersion: string; updatedAt: number; nodeCount: number; nodes: Array<{ id: string; classType: string; title: string; weight: number }> };
type BridgeState = { installed: boolean; version: string | null; authorized: boolean };

const MAX_TEST_FRAME_BYTES = 15 * 1024 * 1024;

const inputAliases: Record<string, string[]> = {
  script: ["script", "text", "prompt"],
  prompt: ["prompt", "positive", "positive_prompt", "text"],
  referenceImage: ["reference_image", "image", "image_path", "filename"],
  characterImages: ["character_images", "reference_images", "images", "image"],
  sceneImage: ["scene_image", "background_image", "image"],
  firstFrame: ["first_frame", "start_image", "image"],
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

function defaultOutputCollection(mediaType: string) {
  if (mediaType === "video") return "videos";
  if (mediaType === "audio") return "audio";
  if (mediaType === "json") return "result";
  return "images";
}

function scoreInput(definition: WorkflowInputDefinition, inputName: string, node: WorkflowNode) {
  const normalized = inputName.toLowerCase();
  const title = `${node.class_type ?? ""} ${node._meta?.title ?? ""}`.toLowerCase();
  const aliases = inputAliases[definition.key] ?? [definition.key.toLowerCase()];
  let score = aliases.reduce((best, alias) => Math.max(best, normalized === alias ? 100 : normalized.includes(alias) ? 65 : 0), 0);
  if (["prompt", "text", "script"].includes(definition.key) && /cliptextencode|textencode/.test(title)) score += 25;
  if (definition.valueType === "image" && /loadimage/.test(title)) score += 25;
  if (definition.valueType === "audio" && /loadaudio|audio.*load/.test(title)) score += 25;
  if (definition.valueType === "video" && /loadvideo|video.*load/.test(title)) score += 25;
  if (definition.key === "prompt" && /positive|正向/.test(title)) score += 30;
  if (definition.key === "prompt" && /negative|负向/.test(title)) score -= 60;
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
  const patterns = mediaType === "image"
    ? [/saveimage/i, /previewimage/i]
    : mediaType === "video"
      ? [/savevideo/i, /videocombine/i, /vhs.*video/i, /combine.*video/i]
      : mediaType === "audio"
        ? [/saveaudio/i, /audio.*save/i, /combine.*audio/i]
        : [/save|output/i];
  return Object.entries(workflow).find(([, node]) => patterns.some((pattern) => pattern.test(node.class_type ?? "")))?.[0] ?? "";
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
  if (message.startsWith("WORKFLOW_VIDEO_TOO_SHORT:")) {
    const [actual, expected] = message.slice("WORKFLOW_VIDEO_TOO_SHORT:".length).split("/");
    return `工作流返回的视频时长异常（实际 ${actual}，要求 ${expected}）`;
  }
  if (message.startsWith("WORKFLOW_INPUT_TARGET_IS_LINK:")) return "工作流输入错误地绑定到了内部连线，请重新绑定执行版";
  return message;
}

export function WorkflowCenter({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilityInfo[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState("storyboard_frame");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [sparkWorkflows, setSparkWorkflows] = useState<SparkWorkflow[]>([]);
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const [bridgeWorkflows, setBridgeWorkflows] = useState<BridgeWorkflow[]>([]);
  const [selectedBridgeWorkflow, setSelectedBridgeWorkflow] = useState<BridgeWorkflow | null>(null);
  const [sparkLoading, setSparkLoading] = useState(true);
  const [selectedSparkName, setSelectedSparkName] = useState("");
  const [testing, setTesting] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowDocument | null>(null);
  const [workflowFileName, setWorkflowFileName] = useState("");
  const [bindingName, setBindingName] = useState("分镜首帧工作流");
  const [inputContract, setInputContract] = useState<InputContract>({});
  const [outputNodeId, setOutputNodeId] = useState("");
  const [outputCollection, setOutputCollection] = useState("images");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [testFrame, setTestFrame] = useState<File | null>(null);
  const [testPrompt, setTestPrompt] = useState("人物缓慢转头看向窗外，镜头轻微推进，动作自然流畅");
  const [testDuration, setTestDuration] = useState(5);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testState, setTestState] = useState("");
  const [testProgress, setTestProgress] = useState(0);
  const [testFailed, setTestFailed] = useState(false);
  const [testNodeProgress, setTestNodeProgress] = useState<ExecutionProgress | null>(null);
  const [testResultUrl, setTestResultUrl] = useState<string | null>(null);
  const [testRuns, setTestRuns] = useState<WorkflowTestRun[]>([]);
  const [testHistoryLoading, setTestHistoryLoading] = useState(false);
  const [editingBinding, setEditingBinding] = useState(false);

  const selected = capabilities.find((item) => item.key === selectedKey) ?? null;
  const binding = bindings.find((item) => item.capability === selectedKey) ?? null;
  const nodes = useMemo(() => Object.entries(workflow ?? {}), [workflow]);
  const missingRequired = selected?.inputs.filter((input) => input.required && !inputContract[input.key]) ?? [];
  const mappedCount = selected?.inputs.filter((input) => Boolean(inputContract[input.key])).length ?? 0;
  const readyToSave = Boolean(workflow && outputNodeId && outputCollection && missingRequired.length === 0);
  const showBindingEditor = !binding || editingBinding;
  const testSteps = [
    { label: "上传首帧", threshold: 20 },
    { label: "进入队列", threshold: 40 },
    { label: "Spark 生成", threshold: 72 },
    { label: "返回视频", threshold: 100 },
  ];
  const activeTestStep = testProgress < 40 ? 0 : testProgress < 72 ? 1 : testProgress < 100 ? 2 : 3;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/workflows/requirements", { cache: "no-store" }),
      fetch("/api/workflows/bindings", { cache: "no-store" }),
      fetch("/api/workflows/connection-test", { cache: "no-store" }),
      fetch("/api/workflows/bridge", { cache: "no-store" }),
    ]).then(async ([requirementsResponse, bindingsResponse, connectionResponse, bridgeResponse]) => {
      if (!requirementsResponse.ok || !bindingsResponse.ok) throw new Error("工作引擎配置加载失败");
      const requirements = await requirementsResponse.json() as { capabilities: WorkflowCapabilityInfo[] };
      const savedBindings = await bindingsResponse.json() as { bindings: WorkflowBinding[] };
      const connectionResult = await connectionResponse.json() as ConnectionState;
      const bridgeResult = await bridgeResponse.json() as { bridge?: BridgeState; workflows?: BridgeWorkflow[] };
      if (cancelled) return;
      setCapabilities(requirements.capabilities);
      setBindings(savedBindings.bindings);
      setConnection(connectionResult);
      setBridge(bridgeResult.bridge ?? null);
      setBridgeWorkflows(bridgeResult.workflows ?? []);
      const current = savedBindings.bindings.find((item) => item.capability === "storyboard_frame");
      setBindingName(current?.name ?? "分镜首帧工作流");
      setInputContract(current?.inputContract ?? {});
      setOutputNodeId(current?.outputContract.nodeId ?? "");
      setOutputCollection(current?.outputContract.output ?? "images");
    }).catch((error: unknown) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "工作引擎配置加载失败"); });
    fetch("/api/workflows/spark-library", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { workflows?: SparkWorkflow[]; error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "Spark 工作流读取失败");
        if (!cancelled) setSparkWorkflows(data.workflows ?? []);
      })
      .catch((error: unknown) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Spark 工作流读取失败"); })
      .finally(() => { if (!cancelled) setSparkLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!testRunId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const response = await fetch(`/api/workflows/test-runs/${testRunId}`, { cache: "no-store" });
      let data: { run?: { status: string; errorMessage?: string; progress?: ExecutionProgress | null; result?: { outputUrl?: string; durationSeconds?: number | null } }; error?: { message?: string } };
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
          setTestState(data.run.status === "running" ? "Spark 正在生成视频（桥接器未上报节点进度）…" : "任务已进入 Spark 队列…");
          setTestProgress(data.run.status === "running" ? 72 : 42);
        }
        setTestFailed(false);
        timer = window.setTimeout(poll, 1800);
        return;
      }
      setTestRunId(null);
      if (data.run.status === "succeeded" && data.run.result?.outputUrl) {
        setTestResultUrl(`${data.run.result.outputUrl}?t=${Date.now()}`);
        setTestState(data.run.result.durationSeconds ? `测试成功，已生成 ${data.run.result.durationSeconds.toFixed(2)} 秒视频` : "测试成功，工作流可以用于正式创作");
        setTestProgress(100);
        setTestNodeProgress((current) => current ? { ...current, overall: 100, stage: "视频已返回" } : null);
        setTestFailed(false);
      } else {
        setTestState(`测试失败：${describeTestError(data.run.errorMessage)}`);
        setTestFailed(true);
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [testRunId]);

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
      } else if (["submitting", "queued", "running"].includes(latest.status)) {
        setTestRunId(latest.id);
        setTestState(latest.status === "running" ? "Spark 正在生成视频…" : "任务已进入 Spark 队列…");
        setTestProgress(latest.status === "running" ? 72 : 42);
        setTestFailed(false);
      } else if (latest.status === "succeeded" && latest.result?.outputUrl) {
        setTestState(latest.result.durationSeconds ? `最近一次测试成功，视频时长 ${latest.result.durationSeconds.toFixed(2)} 秒` : "最近一次测试成功，可直接查看结果");
        setTestProgress(100);
        setTestFailed(false);
        setTestResultUrl(latest.result.outputUrl);
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
    const current = bindings.find((item) => item.capability === key);
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
    setTestFrame(null);
    setTestRunId(null);
    setTestState("");
    setTestProgress(0);
    setTestFailed(false);
    setTestNodeProgress(null);
    setTestResultUrl(null);
    setTestRuns([]);
    if (current && key === "image_to_video") void loadTestRuns(current.id);
  };

  const applyWorkflow = (document: WorkflowDocument, fileName: string, capability: WorkflowCapabilityInfo) => {
    const suggestions = suggestInputContract(document, capability);
    const suggestedOutput = suggestOutputNode(document, capability.outputs[0].mediaType);
    const missing = capability.inputs.filter((input) => input.required && !suggestions[input.key]);
    setWorkflow(document);
    setWorkflowFileName(fileName);
    setInputContract(suggestions);
    setOutputNodeId(suggestedOutput);
    setOutputCollection(defaultOutputCollection(capability.outputs[0].mediaType));
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

  const inspectSparkWorkflow = async (item: SparkWorkflow) => {
    setSelectedBridgeWorkflow(null);
    setSelectedSparkName(item.name);
    setWorkflow(null);
    setWorkflowFileName("");
    if (item.suggestedCapability && item.suggestedCapability !== selectedKey) chooseCapability(item.suggestedCapability);
    setSelectedSparkName(item.name);
    if (item.format !== "api") {
      setSelectedSparkName(item.name);
      setNotice(`“${item.name}”是可视化编辑版。请在 ComfyUI 中打开它并导出 API 格式，再上传到下一步。`);
      return;
    }
    setNotice("正在读取 Spark 执行版工作流…");
    const response = await fetch(`/api/workflows/spark-library?name=${encodeURIComponent(item.name)}`, { cache: "no-store" });
    const data = await response.json() as { workflow?: unknown; error?: { message?: string } };
    const targetCapability = capabilities.find((capability) => capability.key === (item.suggestedCapability ?? selectedKey));
    if (!response.ok || !isApiWorkflow(data.workflow) || !targetCapability) {
      setNotice(data.error?.message ?? "工作流无法作为执行版读取");
      return;
    }
    setSelectedKey(targetCapability.key);
    applyWorkflow(data.workflow, item.name, targetCapability);
  };

  const inspectBridgeWorkflow = async (item: BridgeWorkflow) => {
    setSelectedBridgeWorkflow(item);
    setSelectedSparkName("");
    setWorkflow(null);
    setNotice(`正在从桥接器读取“${item.name}”…`);
    try {
      const response = await fetch(`/api/workflows/bridge?workflowId=${encodeURIComponent(item.id)}&version=${encodeURIComponent(item.latestVersion)}`, { cache: "no-store" });
      const data = await response.json() as { api?: unknown; error?: { message?: string } };
      if (!response.ok || !isApiWorkflow(data.api) || !selected) throw new Error(data.error?.message ?? "桥接工作流读取失败");
      applyWorkflow(data.api, item.name, selected);
      setNotice(`已固定工作流版本 ${item.latestVersion}，确认创作字段后即可启用`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "桥接工作流读取失败");
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
        body: JSON.stringify({ capability: selected.key, name: bindingName, workflow: selectedBridgeWorkflow ? undefined : workflow, bridgeWorkflowId: selectedBridgeWorkflow?.id, bridgeVersion: selectedBridgeWorkflow?.latestVersion, inputContract, outputContract: { nodeId: outputNodeId, output: outputCollection, mediaType: selected.outputs[0].mediaType } satisfies OutputContract, enabled: true }),
      });
      const data = await response.json() as { binding?: WorkflowBinding; error?: { message?: string } };
      if (!response.ok || !data.binding) throw new Error(data.error?.message ?? "工作流保存失败");
      setBindings((current) => [...current.filter((item) => item.capability !== data.binding?.capability), data.binding!]);
      setCapabilities((current) => current.map((item) => item.key === selected.key ? { ...item, configured: true, bindingId: data.binding!.id, bindingName: data.binding!.name } : item));
      setEditingBinding(false);
      setWorkflow(null);
      setWorkflowFileName("");
      setNotice("绑定完成，可以回到创作页面生成内容");
      if (selected.key === "image_to_video") void loadTestRuns(data.binding.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作流保存失败");
    } finally {
      setSaving(false);
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
    if (!binding || selectedKey !== "image_to_video" || !testFrame) {
      setTestState("请先选择一张首帧图片");
      return;
    }
    if (testFrame.size > MAX_TEST_FRAME_BYTES) {
      setTestState("提交失败：首帧不能超过 15 MB");
      setTestProgress(0);
      setTestFailed(true);
      return;
    }
    setTestResultUrl(null);
    setTestState("正在上传首帧并提交测试…");
    setTestProgress(8);
    setTestNodeProgress(null);
    setTestFailed(false);
    try {
      const form = new FormData();
      form.append("firstFrame", testFrame);
      form.append("prompt", testPrompt);
      form.append("duration", String(testDuration));
      form.append("promptEnhance", "true");
      const response = await fetch(`/api/workflows/bindings/${binding.id}/test`, { method: "POST", body: form });
      const data = await readApiJson<{ run?: { id: string }; error?: { message?: string; details?: { reason?: string } } }>(response);
      if (!response.ok || !data.run) throw new Error(data.error?.details?.reason ?? data.error?.message ?? "无法启动测试");
      setTestRunId(data.run.id);
      setTestState("任务已提交，正在等待 Spark…");
      setTestProgress(40);
    } catch (error) {
      setTestState(`提交失败：${error instanceof Error ? error.message : "无法启动测试"}`);
      setTestProgress(8);
      setTestFailed(true);
    }
  };

  return (
    <StudioShell view="workflows" onNavigate={onNavigate}>
      <div className="workflow-page page-scroll">
        <header className="workflow-heading">
          <div><p className="eyebrow">工作引擎</p><h1>连接一次，创作时直接使用</h1><p>系统自动发现 Spark 工作流并推荐用途；创作者不会看到 ComfyUI 节点。</p></div>
          <div className={`engine-status ${connection?.connected && bridge?.authorized ? "connected" : ""}`}><i /><div><b>{bridge?.authorized ? "小飞象桥接器已连接" : bridge?.installed ? "桥接器需要密钥" : connection?.connected ? "Spark 已连接，等待安装桥接器" : connection?.configured ? "Spark 连接异常" : "等待配置 Spark"}</b><span>{bridge?.authorized ? `版本 ${bridge.version} · 已同步 ${bridgeWorkflows.length} 个工作流` : connection?.message ?? "正在检查连接…"}{connection?.connected ? ` · ${connection.deviceCount ?? 0} 个设备` : ""}</span></div><AppButton onClick={testConnection} disabled={testing}>{testing ? "检测中" : "检测连接"}</AppButton></div>
        </header>

        <div className="workflow-layout">
          <aside className="capability-list">
            <div className="capability-summary"><b>{capabilities.filter((item) => item.configured).length}/{capabilities.length}</b><span>项生成能力已连接</span><div><i style={{ width: `${capabilities.length ? capabilities.filter((item) => item.configured).length / capabilities.length * 100 : 0}%` }} /></div></div>
            {capabilities.map((item) => <button key={item.key} className={selectedKey === item.key ? "active" : ""} onClick={() => chooseCapability(item.key)}><span>{item.configured ? "✓" : "·"}</span><div><b>{item.name}</b><small>{item.configured ? item.bindingName : "尚未绑定"}</small></div></button>)}
          </aside>

          <main className="workflow-config guided-workflow-config">
            {selected && <>
              <div className="workflow-config-title"><div><span>{selected.configured ? "已启用" : "待配置"}</span><h2>{selected.name}</h2><p>{selected.requirement}</p></div>{binding && <em>当前绑定：{binding.name}</em>}</div>

              {binding && !editingBinding && <section className="bound-workflow-card">
                <div className="bound-workflow-heading">
                  <span>✓</span>
                  <div><b>执行版已保存并启用</b><p>{binding.name} · 无需重新上传 JSON</p></div>
                  <AppButton onClick={() => { setEditingBinding(true); setNotice("请从 Spark 选择或上传新的 API 执行版"); }}>替换工作流</AppButton>
                </div>
                <div className="bound-workflow-summary">
                  <div><span>创作输入</span><b>{Object.keys(binding.inputContract).length} 项已绑定</b></div>
                  <div><span>最终输出</span><b>{binding.outputContract.mediaType === "video" ? "视频" : binding.outputContract.mediaType === "audio" ? "音频" : "图片"} · 自动归档</b></div>
                  <div><span>运行状态</span><b className="healthy">可用于正式创作</b></div>
                </div>
                <details className="bound-mapping-details"><summary>查看已保存的字段映射</summary><div>{selected.inputs.filter((input) => binding.inputContract[input.key]).map((input) => <p key={input.key}><span>{input.label}</span><code>{binding.inputContract[input.key].nodeId} / {binding.inputContract[input.key].input}</code></p>)}<p><span>最终输出</span><code>{binding.outputContract.nodeId} / {binding.outputContract.output}</code></p></div></details>
              </section>}

              {binding && selectedKey === "image_to_video" && !editingBinding && <section className="workflow-section workflow-test-section">
                <div className="workflow-section-title"><b>立即测试已绑定工作流</b><span>真实调用 Spark，不会写入短剧项目</span></div>
                <div className={`workflow-test-status ${testFailed ? "failed" : ""}`} aria-live="polite">
                  <div><b>{testHistoryLoading ? "正在恢复测试记录…" : testState || "选择首帧后即可开始测试"}</b><span>{testProgress > 0 ? `${testProgress}%` : "等待开始"}</span></div>
                  <div className="test-progress-track"><i style={{ width: `${testProgress}%` }} /></div>
                  <ol>{testSteps.map((step, index) => <li key={step.label} className={testProgress >= step.threshold ? "done" : testProgress > 0 && index === activeTestStep ? "active" : ""}><i>{testProgress >= step.threshold ? "✓" : ""}</i><span>{step.label}</span></li>)}</ol>
                  {testNodeProgress && <div className="node-progress-detail"><div><span>当前节点</span><b>{testNodeProgress.currentNodeTitle ?? "等待节点"}</b><code>#{testNodeProgress.currentNodeId ?? "-"}</code></div><div><span>节点进度</span><b>{testNodeProgress.nodeMax ? `${testNodeProgress.nodeValue ?? 0} / ${testNodeProgress.nodeMax}` : "执行中"}</b></div><div><span>完成节点</span><b>{testNodeProgress.completedNodes} / {testNodeProgress.totalNodes}</b>{testNodeProgress.cachedNodes > 0 && <small>缓存 {testNodeProgress.cachedNodes}</small>}</div></div>}
                </div>
                <div className="workflow-test-layout">
                  <div className="workflow-test-form">
                    <label className={`test-frame-upload ${testFrame ? "selected" : ""}`}><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0] ?? null; setTestFrame(file); setTestFailed(false); setTestProgress(0); setTestState(file ? "首帧已选择，可以开始测试" : ""); }} /><span>{testFrame ? "✓" : "＋"}</span><div><b>{testFrame?.name ?? "上传一张分镜首帧"}</b><small>{testFrame ? `${Math.max(1, Math.round(testFrame.size / 1024))} KB` : "PNG、JPG 或 WEBP · 最大 15 MB"}</small></div></label>
                    <label><span>动作描述</span><textarea value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} /></label>
                    <label className="test-duration"><span>视频时长</span><input type="number" min={1} max={30} value={testDuration} onChange={(event) => setTestDuration(Number(event.target.value))} /><i>秒</i></label>
                    <div className="test-submit-row"><AppButton primary disabled={Boolean(testRunId) || !testFrame || !testPrompt.trim()} onClick={startWorkflowTest}>{testRunId ? "Spark 生成中…" : "开始真实测试"}</AppButton><p>{testRunId ? "可以留在本页，进度会自动更新" : "点击后会立即显示提交状态"}</p></div>
                  </div>
                  <div className={`workflow-test-result ${testResultUrl ? "has-result" : ""}`}>{testResultUrl ? <video controls src={testResultUrl} /> : <div><span>▶</span><b>等待测试视频</b><p>生成完成后会直接在这里播放</p></div>}</div>
                </div>
                {testRuns.length > 0 && <div className="test-history"><b>最近测试</b>{testRuns.slice(0, 4).map((run) => <div key={run.id}><i className={run.status}>{run.status === "succeeded" ? "✓" : run.status === "failed" ? "!" : "…"}</i><span>{run.status === "succeeded" ? "测试成功" : run.status === "failed" ? "测试失败" : "生成中"}</span><time>{new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>{run.result?.outputUrl && <button onClick={() => setTestResultUrl(`${run.result!.outputUrl}?t=${Date.now()}`)}>查看视频</button>}</div>)}</div>}
              </section>}

              {showBindingEditor && <>

              <section className="workflow-section spark-library-section">
                <div className="workflow-section-title"><b>1. 从 ComfyUI 选择工作流</b><span>{bridge?.authorized ? `已同步 ${bridgeWorkflows.length} 个` : "需要小飞象桥接器"}</span></div>
                {bridge?.authorized ? <><div className="spark-workflow-grid">{bridgeWorkflows.map((item) => <button key={item.id} className={selectedBridgeWorkflow?.id === item.id ? "active" : ""} onClick={() => void inspectBridgeWorkflow(item)}><div><strong>{item.name.replace(/\.json$/i, "")}</strong><span className="workflow-format api">已同步</span></div><p>固定版本：{item.latestVersion}</p><small>{item.nodeCount} 个执行节点 · 可直接绑定</small></button>)}</div>{!bridgeWorkflows.length && <div className="workflow-empty">在 ComfyUI 中打开并运行一次工作流，它会自动出现在这里</div>}</> : <div className="format-guidance"><span>!</span><div><b>{bridge?.installed ? "桥接器已安装，但小飞象与 ComfyUI 的密钥不一致" : "Spark 尚未安装小飞象工作流桥接器"}</b><p>安装后，ComfyUI 中已有工作流会自动同步；生成时会回传真实节点和百分比。</p></div>{connection?.serverUrl && <a href={connection.serverUrl} target="_blank" rel="noreferrer">打开 ComfyUI ↗</a>}</div>}
                <details className="compat-workflow-source"><summary>兼容模式：查看 Spark 文件或上传 API JSON</summary><div className="spark-workflow-grid">{sparkWorkflows.map((item) => <button key={item.name} className={selectedSparkName === item.name ? "active" : ""} onClick={() => void inspectSparkWorkflow(item)}><div><strong>{item.name.replace(/\.json$/i, "")}</strong><span className={`workflow-format ${item.format}`}>{item.format === "api" ? "执行版" : item.format === "editor" ? "可视化版" : "无法识别"}</span></div><p>建议用于：{item.suggestedLabel}</p><small>{item.nodeCount} 个节点</small></button>)}</div>{sparkLoading && <div className="workflow-empty">正在读取 Spark 文件…</div>}<label className={`workflow-dropzone ${workflow && !selectedBridgeWorkflow ? "has-file" : ""}`}><input type="file" accept="application/json,.json" onChange={(event) => void uploadWorkflow(event.target.files?.[0])} /><strong>{workflow && !selectedBridgeWorkflow ? "✓" : "＋"}</strong><div><b>{workflow && !selectedBridgeWorkflow ? workflowFileName : "上传 API 格式 JSON"}</b><span>仅用于桥接器尚未安装时的兼容操作</span></div></label></details>
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
                <div className="workflow-section-title"><b>3. 确认生成结果</b><span>完成后自动回到对应资产或分镜</span></div>
                <div className="output-contract guided-output"><label><span>最终输出</span><select value={outputNodeId} disabled={!workflow} onChange={(event) => setOutputNodeId(event.target.value)}><option value="">选择最终输出节点</option>{nodes.map(([nodeId, node]) => <option key={nodeId} value={nodeId}>{nodeLabel(nodeId, node)}</option>)}</select></label><div><span>归档位置</span><b>{selected.outputs[0].label} · 自动归档</b></div><details><summary>高级设置</summary><label>结果字段<input value={outputCollection} disabled={!workflow} onChange={(event) => setOutputCollection(event.target.value)} /></label></details></div>
              </section>

              <div className="workflow-savebar"><div><label>配置名称<input value={bindingName} onChange={(event) => setBindingName(event.target.value)} /></label>{notice && <p>{notice}</p>}</div><AppButton primary onClick={save} disabled={saving || !readyToSave}>{saving ? "保存中…" : binding ? "更新并启用" : "确认绑定并启用"}</AppButton></div>
              </>}
            </>}
          </main>
        </div>
      </div>
    </StudioShell>
  );
}
