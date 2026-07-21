"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import type { View, WorkflowCapabilityInfo } from "../studio/types";

type WorkflowDocument = Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }>;
type InputContract = Record<string, { nodeId: string; input: string }>;
type OutputContract = { nodeId: string; output: string; mediaType: "image" | "video" | "audio" | "json" };
type WorkflowBinding = {
  id: string;
  capability: string;
  name: string;
  inputContract: InputContract;
  outputContract: OutputContract;
  enabled: boolean;
};
type ConnectionState = { configured: boolean; connected: boolean; deviceCount?: number; system?: string | null; message: string };

function nodeLabel(nodeId: string, node: WorkflowDocument[string]) {
  return `${nodeId} · ${node._meta?.title || node.class_type || "未命名节点"}`;
}

export function WorkflowCenter({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilityInfo[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState("storyboard_frame");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [testing, setTesting] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowDocument | null>(null);
  const [workflowFileName, setWorkflowFileName] = useState("");
  const [bindingName, setBindingName] = useState("分镜首帧工作流");
  const [inputContract, setInputContract] = useState<InputContract>({});
  const [outputNodeId, setOutputNodeId] = useState("");
  const [outputCollection, setOutputCollection] = useState("images");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = capabilities.find((item) => item.key === selectedKey) ?? null;
  const binding = bindings.find((item) => item.capability === selectedKey) ?? null;
  const nodes = useMemo(() => Object.entries(workflow ?? {}), [workflow]);

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
    return () => { cancelled = true; };
  }, []);

  const chooseCapability = (key: string) => {
    const current = bindings.find((item) => item.capability === key);
    const definition = capabilities.find((item) => item.key === key);
    setSelectedKey(key);
    setBindingName(current?.name ?? `${definition?.name ?? "生成"}工作流`);
    setInputContract(current?.inputContract ?? {});
    setOutputNodeId(current?.outputContract.nodeId ?? "");
    setOutputCollection(current?.outputContract.output ?? (definition?.outputs[0]?.mediaType === "video" ? "videos" : definition?.outputs[0]?.mediaType === "audio" ? "audio" : "images"));
    setWorkflow(null);
    setWorkflowFileName("");
    setNotice("");
  };

  const uploadWorkflow = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as WorkflowDocument;
      if (!parsed || Array.isArray(parsed) || !Object.keys(parsed).length || Object.values(parsed).some((node) => typeof node?.class_type !== "string")) throw new Error("这不是 ComfyUI API 格式工作流");
      setWorkflow(parsed);
      setWorkflowFileName(file.name);
      setInputContract({});
      const likelyOutput = Object.entries(parsed).find(([, node]) => /save|preview/i.test(node.class_type ?? ""));
      setOutputNodeId(likelyOutput?.[0] ?? "");
      setNotice("工作流已读取，请确认输入和输出映射");
    } catch (error) {
      setWorkflow(null);
      setWorkflowFileName("");
      setNotice(error instanceof Error ? error.message : "工作流读取失败");
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
    if (!selected || !workflow) {
      setNotice(binding ? "如需修改，请重新上传工作流文件" : "请先上传工作流文件");
      return;
    }
    setSaving(true);
    setNotice("正在保存并校验工作流…");
    try {
      const response = await fetch("/api/workflows/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: selected.key,
          name: bindingName,
          workflow,
          inputContract,
          outputContract: { nodeId: outputNodeId, output: outputCollection, mediaType: selected.outputs[0].mediaType } satisfies OutputContract,
          enabled: true,
        }),
      });
      const data = await response.json() as { binding?: WorkflowBinding; error?: { message?: string } };
      if (!response.ok || !data.binding) throw new Error(data.error?.message ?? "工作流保存失败");
      setBindings((current) => [...current.filter((item) => item.capability !== data.binding?.capability), data.binding!]);
      setCapabilities((current) => current.map((item) => item.key === selected.key ? { ...item, configured: true, bindingId: data.binding!.id, bindingName: data.binding!.name } : item));
      setNotice("工作流已绑定，可以从创作页面提交生成任务");
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

  return (
    <StudioShell view="workflows" onNavigate={onNavigate}>
      <div className="workflow-page page-scroll">
        <header className="workflow-heading">
          <div><p className="eyebrow">工作引擎</p><h1>把 ComfyUI 能力接入小飞象</h1><p>创作者只使用角色、场景和分镜；节点参数由这里统一管理。</p></div>
          <div className={`engine-status ${connection?.connected ? "connected" : ""}`}><i /><div><b>{connection?.connected ? "Spark 已连接" : connection?.configured ? "Spark 连接异常" : "等待配置 Spark"}</b><span>{connection?.message ?? "正在检查连接…"}{connection?.connected ? ` · ${connection.deviceCount ?? 0} 个设备` : ""}</span></div><AppButton onClick={testConnection} disabled={testing}>{testing ? "检测中" : "检测连接"}</AppButton></div>
        </header>

        <div className="workflow-layout">
          <aside className="capability-list">
            <div className="capability-summary"><b>{capabilities.filter((item) => item.configured).length}/{capabilities.length}</b><span>项生成能力已连接</span><div><i style={{ width: `${capabilities.length ? capabilities.filter((item) => item.configured).length / capabilities.length * 100 : 0}%` }} /></div></div>
            {capabilities.map((item) => <button key={item.key} className={selectedKey === item.key ? "active" : ""} onClick={() => chooseCapability(item.key)}><span>{item.configured ? "✓" : "·"}</span><div><b>{item.name}</b><small>{item.configured ? item.bindingName : "尚未绑定"}</small></div></button>)}
          </aside>

          <main className="workflow-config">
            {selected && <>
              <div className="workflow-config-title"><div><span>{selected.configured ? "已启用" : "待配置"}</span><h2>{selected.name}</h2><p>{selected.requirement}</p></div>{binding && <em>上次配置：{binding.name}</em>}</div>
              <section className="workflow-section">
                <div className="workflow-section-title"><b>1. 工作流文件</b><span>请从 ComfyUI 导出「API 格式」JSON</span></div>
                <label className={`workflow-dropzone ${workflow ? "has-file" : ""}`}><input type="file" accept="application/json,.json" onChange={(event) => void uploadWorkflow(event.target.files?.[0])} /><strong>{workflow ? "✓" : "＋"}</strong><div><b>{workflowFileName || (binding ? "重新上传以修改现有绑定" : "选择 ComfyUI 工作流")}</b><span>{workflow ? `已识别 ${nodes.length} 个节点` : "工作流文件只保存在服务端，不暴露给创作者"}</span></div></label>
              </section>

              <section className="workflow-section">
                <div className="workflow-section-title"><b>2. 输入映射</b><span>把小飞象的创作字段送到正确节点</span></div>
                <div className="contract-grid">{selected.inputs.map((input) => {
                  const current = inputContract[input.key];
                  const value = current ? `${current.nodeId}::${current.input}` : "";
                  return <label key={input.key}><span>{input.label}{input.required && <i>*</i>}<small>{input.key} · {input.valueType}</small></span><select value={value} disabled={!workflow} onChange={(event) => mapInput(input.key, event.target.value)}><option value="">{workflow ? "选择节点输入" : binding ? `${current?.nodeId ?? "已保存"} · ${current?.input ?? "映射"}` : "请先上传工作流"}</option>{nodes.flatMap(([nodeId, node]) => Object.keys(node.inputs ?? {}).map((inputName) => <option key={`${nodeId}-${inputName}`} value={`${nodeId}::${inputName}`}>{nodeLabel(nodeId, node)} / {inputName}</option>))}</select></label>;
                })}</div>
              </section>

              <section className="workflow-section">
                <div className="workflow-section-title"><b>3. 结果回传</b><span>生成完成后自动归档到对应角色、场景或分镜</span></div>
                <div className="output-contract"><label><span>输出节点</span><select value={outputNodeId} disabled={!workflow} onChange={(event) => setOutputNodeId(event.target.value)}><option value="">选择输出节点</option>{nodes.map(([nodeId, node]) => <option key={nodeId} value={nodeId}>{nodeLabel(nodeId, node)}</option>)}</select></label><label><span>输出集合</span><input value={outputCollection} disabled={!workflow} onChange={(event) => setOutputCollection(event.target.value)} placeholder="images" /></label><div><span>归档类型</span><b>{selected.outputs[0].label} · {selected.outputs[0].mediaType}</b></div></div>
              </section>
              <div className="workflow-savebar"><div><label>配置名称<input value={bindingName} onChange={(event) => setBindingName(event.target.value)} /></label>{notice && <p>{notice}</p>}</div><AppButton primary onClick={save} disabled={saving}>{saving ? "保存中…" : binding ? "更新工作流绑定" : "保存并启用"}</AppButton></div>
            </>}
          </main>
        </div>
      </div>
    </StudioShell>
  );
}
