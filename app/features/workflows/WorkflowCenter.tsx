"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import type { View, WorkflowCapabilityInfo, WorkflowInputDefinition } from "../studio/types";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
type WorkflowDocument = Record<string, WorkflowNode>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
type WorkflowBinding = { id: string; capability: string; name: string; inputContract: InputContract; outputContract: OutputContract; enabled: boolean };
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

export function WorkflowCenter({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilityInfo[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState("storyboard_frame");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [sparkWorkflows, setSparkWorkflows] = useState<SparkWorkflow[]>([]);
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
  const [testResultUrl, setTestResultUrl] = useState<string | null>(null);

  const selected = capabilities.find((item) => item.key === selectedKey) ?? null;
  const binding = bindings.find((item) => item.capability === selectedKey) ?? null;
  const nodes = useMemo(() => Object.entries(workflow ?? {}), [workflow]);
  const missingRequired = selected?.inputs.filter((input) => input.required && !inputContract[input.key]) ?? [];
  const mappedCount = selected?.inputs.filter((input) => Boolean(inputContract[input.key])).length ?? 0;
  const readyToSave = Boolean(workflow && outputNodeId && outputCollection && missingRequired.length === 0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/workflows/requirements", { cache: "no-store" }),
      fetch("/api/workflows/bindings", { cache: "no-store" }),
      fetch("/api/workflows/connection-test", { cache: "no-store" }),
    ]).then(async ([requirementsResponse, bindingsResponse, connectionResponse]) => {
      if (!requirementsResponse.ok || !bindingsResponse.ok) throw new Error("工作引擎配置加载失败");
      const requirements = await requirementsResponse.json() as { capabilities: WorkflowCapabilityInfo[] };
      const savedBindings = await bindingsResponse.json() as { bindings: WorkflowBinding[] };
      const connectionResult = await connectionResponse.json() as ConnectionState;
      if (cancelled) return;
      setCapabilities(requirements.capabilities);
      setBindings(savedBindings.bindings);
      setConnection(connectionResult);
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
      const data = await response.json() as { run?: { status: string; errorMessage?: string; result?: { outputUrl?: string } } };
      if (cancelled || !data.run) return;
      if (["submitting", "queued", "running"].includes(data.run.status)) {
        setTestState(data.run.status === "running" ? "Spark 正在生成视频…" : "任务已进入 Spark 队列…");
        timer = window.setTimeout(poll, 1800);
        return;
      }
      setTestRunId(null);
      if (data.run.status === "succeeded" && data.run.result?.outputUrl) {
        setTestResultUrl(`${data.run.result.outputUrl}?t=${Date.now()}`);
        setTestState("测试成功，工作流可以用于正式创作");
      } else {
        setTestState(`测试失败：${data.run.errorMessage ?? "请检查工作流参数和输出映射"}`);
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [testRunId]);

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
    setNotice("");
    setTestFrame(null);
    setTestRunId(null);
    setTestState("");
    setTestResultUrl(null);
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
      applyWorkflow(parsed, file.name, selected);
    } catch (error) {
      setWorkflow(null);
      setWorkflowFileName("");
      setNotice(error instanceof Error ? error.message : "工作流读取失败");
    }
  };

  const inspectSparkWorkflow = async (item: SparkWorkflow) => {
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
        body: JSON.stringify({ capability: selected.key, name: bindingName, workflow, inputContract, outputContract: { nodeId: outputNodeId, output: outputCollection, mediaType: selected.outputs[0].mediaType } satisfies OutputContract, enabled: true }),
      });
      const data = await response.json() as { binding?: WorkflowBinding; error?: { message?: string } };
      if (!response.ok || !data.binding) throw new Error(data.error?.message ?? "工作流保存失败");
      setBindings((current) => [...current.filter((item) => item.capability !== data.binding?.capability), data.binding!]);
      setCapabilities((current) => current.map((item) => item.key === selected.key ? { ...item, configured: true, bindingId: data.binding!.id, bindingName: data.binding!.name } : item));
      setNotice("绑定完成，可以回到创作页面生成内容");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作流保存失败");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    const response = await fetch("/api/workflows/connection-test", { cache: "no-store" });
    setConnection(await response.json() as ConnectionState);
    setTesting(false);
  };

  const startWorkflowTest = async () => {
    if (!binding || selectedKey !== "image_to_video" || !testFrame) {
      setTestState("请先选择一张首帧图片");
      return;
    }
    setTestResultUrl(null);
    setTestState("正在上传首帧并提交测试…");
    const form = new FormData();
    form.append("firstFrame", testFrame);
    form.append("prompt", testPrompt);
    form.append("duration", String(testDuration));
    const response = await fetch(`/api/workflows/bindings/${binding.id}/test`, { method: "POST", body: form });
    const data = await response.json() as { run?: { id: string }; error?: { message?: string; details?: { reason?: string } } };
    if (!response.ok || !data.run) {
      setTestState(`提交失败：${data.error?.details?.reason ?? data.error?.message ?? "无法启动测试"}`);
      return;
    }
    setTestRunId(data.run.id);
    setTestState("任务已提交，正在等待 Spark…");
  };

  return (
    <StudioShell view="workflows" onNavigate={onNavigate}>
      <div className="workflow-page page-scroll">
        <header className="workflow-heading">
          <div><p className="eyebrow">工作引擎</p><h1>连接一次，创作时直接使用</h1><p>系统自动发现 Spark 工作流并推荐用途；创作者不会看到 ComfyUI 节点。</p></div>
          <div className={`engine-status ${connection?.connected ? "connected" : ""}`}><i /><div><b>{connection?.connected ? "Spark 已连接" : connection?.configured ? "Spark 连接异常" : "等待配置 Spark"}</b><span>{connection?.message ?? "正在检查连接…"}{connection?.connected ? ` · ${connection.deviceCount ?? 0} 个设备` : ""}</span></div><AppButton onClick={testConnection} disabled={testing}>{testing ? "检测中" : "检测连接"}</AppButton></div>
        </header>

        <div className="workflow-layout">
          <aside className="capability-list">
            <div className="capability-summary"><b>{capabilities.filter((item) => item.configured).length}/{capabilities.length}</b><span>项生成能力已连接</span><div><i style={{ width: `${capabilities.length ? capabilities.filter((item) => item.configured).length / capabilities.length * 100 : 0}%` }} /></div></div>
            {capabilities.map((item) => <button key={item.key} className={selectedKey === item.key ? "active" : ""} onClick={() => chooseCapability(item.key)}><span>{item.configured ? "✓" : "·"}</span><div><b>{item.name}</b><small>{item.configured ? item.bindingName : "尚未绑定"}</small></div></button>)}
          </aside>

          <main className="workflow-config guided-workflow-config">
            {selected && <>
              <div className="workflow-config-title"><div><span>{selected.configured ? "已启用" : "待配置"}</span><h2>{selected.name}</h2><p>{selected.requirement}</p></div>{binding && <em>当前绑定：{binding.name}</em>}</div>

              <section className="workflow-section spark-library-section">
                <div className="workflow-section-title"><b>1. 从 Spark 选择已有工作流</b><span>{sparkLoading ? "正在读取…" : `发现 ${sparkWorkflows.length} 个工作流`}</span></div>
                <div className="spark-workflow-grid">{sparkWorkflows.map((item) => <button key={item.name} className={selectedSparkName === item.name ? "active" : ""} onClick={() => void inspectSparkWorkflow(item)}><div><strong>{item.name.replace(/\.json$/i, "")}</strong><span className={`workflow-format ${item.format}`}>{item.format === "api" ? "执行版" : item.format === "editor" ? "可视化版" : "无法识别"}</span></div><p>建议用于：{item.suggestedLabel}</p><small>{item.nodeCount} 个节点{item.format === "editor" ? " · 需导出 API 格式" : " · 可直接绑定"}</small></button>)}</div>
                {!sparkLoading && !sparkWorkflows.length && <div className="workflow-empty">Spark 上还没有保存的工作流</div>}
                {selectedSparkName && sparkWorkflows.find((item) => item.name === selectedSparkName)?.format === "editor" && <div className="format-guidance"><span>!</span><div><b>当前是可视化编辑版，不能直接执行</b><p>在 ComfyUI 中打开“{selectedSparkName.replace(/\.json$/i, "")}”，选择导出 API 格式，然后上传到下一步。只需做一次。</p></div>{connection?.serverUrl && <a href={connection.serverUrl} target="_blank" rel="noreferrer">打开 ComfyUI ↗</a>}</div>}
              </section>

              <section className="workflow-section">
                <div className="workflow-section-title"><b>2. 上传执行版</b><span>系统会自动识别输入和最终输出</span></div>
                <label className={`workflow-dropzone ${workflow ? "has-file" : ""}`}><input type="file" accept="application/json,.json" onChange={(event) => void uploadWorkflow(event.target.files?.[0])} /><strong>{workflow ? "✓" : "＋"}</strong><div><b>{workflowFileName || "拖入从 ComfyUI 导出的 API 格式 JSON"}</b><span>{workflow ? `已识别 ${nodes.length} 个执行节点，并完成自动映射` : "不需要修改 JSON，也不需要填写节点编号"}</span></div></label>
              </section>

              <section className={`workflow-section ${workflow ? "" : "section-disabled"}`}>
                <div className="workflow-section-title"><b>3. 确认创作字段</b><span>{workflow ? `${mappedCount}/${selected.inputs.length} 项已识别` : "上传执行版后自动出现"}</span></div>
                <div className="contract-grid">{selected.inputs.map((input) => {
                  const current = inputContract[input.key];
                  const value = current ? `${current.nodeId}::${current.input}` : "";
                  return <label key={input.key} className={current ? "mapped" : input.required ? "missing" : ""}><span>{input.label}{input.required && <i>*</i>}<small>{current ? "已自动识别" : input.required ? "需要确认" : "可选"}</small></span><select value={value} disabled={!workflow} onChange={(event) => mapInput(input.key, event.target.value)}><option value="">{workflow ? "选择对应输入" : "等待识别"}</option>{nodes.flatMap(([nodeId, node]) => Object.keys(node.inputs ?? {}).map((inputName) => <option key={`${nodeId}-${inputName}`} value={`${nodeId}::${inputName}`}>{nodeLabel(nodeId, node)} / {inputName}</option>))}</select></label>;
                })}</div>
              </section>

              <section className={`workflow-section ${workflow ? "" : "section-disabled"}`}>
                <div className="workflow-section-title"><b>4. 确认生成结果</b><span>完成后自动回到对应资产或分镜</span></div>
                <div className="output-contract guided-output"><label><span>最终输出</span><select value={outputNodeId} disabled={!workflow} onChange={(event) => setOutputNodeId(event.target.value)}><option value="">选择最终输出节点</option>{nodes.map(([nodeId, node]) => <option key={nodeId} value={nodeId}>{nodeLabel(nodeId, node)}</option>)}</select></label><div><span>归档位置</span><b>{selected.outputs[0].label} · 自动归档</b></div><details><summary>高级设置</summary><label>结果字段<input value={outputCollection} disabled={!workflow} onChange={(event) => setOutputCollection(event.target.value)} /></label></details></div>
              </section>

              {binding && selectedKey === "image_to_video" && <section className="workflow-section workflow-test-section">
                <div className="workflow-section-title"><b>5. 测试运行</b><span>独立验证，不会写入短剧项目</span></div>
                <div className="workflow-test-layout">
                  <div className="workflow-test-form">
                    <label className={`test-frame-upload ${testFrame ? "selected" : ""}`}><input type="file" accept="image/*" onChange={(event) => setTestFrame(event.target.files?.[0] ?? null)} /><span>{testFrame ? "✓" : "＋"}</span><div><b>{testFrame?.name ?? "上传一张分镜首帧"}</b><small>{testFrame ? `${Math.max(1, Math.round(testFrame.size / 1024))} KB` : "PNG、JPG 或 WEBP"}</small></div></label>
                    <label><span>动作描述</span><textarea value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} /></label>
                    <label className="test-duration"><span>视频时长</span><input type="number" min={1} max={30} value={testDuration} onChange={(event) => setTestDuration(Number(event.target.value))} /><i>秒</i></label>
                    <div className="test-submit-row"><AppButton primary disabled={Boolean(testRunId) || !testFrame || !testPrompt.trim()} onClick={startWorkflowTest}>{testRunId ? "生成中…" : "开始测试"}</AppButton><p>{testState || "测试会真实占用 Spark GPU"}</p></div>
                  </div>
                  <div className={`workflow-test-result ${testResultUrl ? "has-result" : ""}`}>{testResultUrl ? <video controls src={testResultUrl} /> : <div><span>▶</span><b>等待测试视频</b><p>生成完成后会直接在这里播放</p></div>}</div>
                </div>
              </section>}

              <div className="workflow-savebar"><div><label>配置名称<input value={bindingName} onChange={(event) => setBindingName(event.target.value)} /></label>{notice && <p>{notice}</p>}</div><AppButton primary onClick={save} disabled={saving || !readyToSave}>{saving ? "保存中…" : binding ? "更新并启用" : "确认绑定并启用"}</AppButton></div>
            </>}
          </main>
        </div>
      </div>
    </StudioShell>
  );
}
