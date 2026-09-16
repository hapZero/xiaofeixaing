"use client";

import { useEffect, useState } from "react";
import { AppButton } from "../../components/ui";
import type { SettingsSection } from "../../lib/workflow-capabilities";

type ConnectionKind = "llm" | "vision";
type SavedConnection = {
  id: string;
  kind: ConnectionKind;
  name: string;
  baseUrl: string;
  model: string | null;
  hasCredential: boolean;
  enabled: boolean;
  lastTestStatus: "untested" | "invalidated" | "succeeded" | "failed";
  lastTestedAt: string | null;
  lastTestError: string | null;
};
type EngineResponse = {
  connections?: SavedConnection[];
  comfy?: { configured: boolean; connected: boolean; serverUrl: string | null; message: string };
};
type RuntimeStatus = {
  batchRunner?: {
    connected: boolean;
    status: "online" | "degraded" | "offline";
    mode: "continuous" | "scheduled" | null;
    active: number;
    lastSeenAt: string | null;
    message: string;
  };
  mediaWorker?: { configured: boolean; connected: boolean; serverUrl: string; message: string };
};
type BridgeState = { installed: boolean; version: string | null; authorized: boolean };
type ConnectionState = { configured: boolean; connected: boolean; deviceCount?: number; serverUrl?: string | null; message: string };

function heartbeatLabel(value: string | null | undefined) {
  if (!value) return "从未收到";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function ModelConnectionCard({ kind, saved, loading, onReadinessChanged }: { kind: ConnectionKind; saved: SavedConnection | null; loading: boolean; onReadinessChanged: () => void }) {
  const vision = kind === "vision";
  const [name, setName] = useState(saved?.name ?? (vision ? "视觉连续性质检" : "文本智能服务"));
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [model, setModel] = useState(saved?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [hasCredential, setHasCredential] = useState(Boolean(saved?.hasCredential));
  const [testStatus, setTestStatus] = useState<SavedConnection["lastTestStatus"]>(saved?.lastTestStatus ?? "untested");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const save = async () => {
    setSaving(true);
    setFailed(false);
    setMessage(`正在加密保存${vision ? "视觉质检" : "文本智能"}服务…`);
    try {
      const response = await fetch("/api/engine/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name, provider: "openai-compatible", baseUrl, model, apiKey: apiKey || undefined, enabled: true }),
      });
      const data = await response.json() as { connection?: SavedConnection; error?: { message?: string } };
      if (!response.ok || !data.connection) throw new Error(data.error?.message ?? "服务保存失败");
      setHasCredential(data.connection.hasCredential);
      setTestStatus("invalidated");
      setApiKey("");
      setMessage("服务已加密保存；请完成一次真实连接测试后投入生产");
      onReadinessChanged();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "服务保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setFailed(false);
    setMessage(vision ? "正在发送测试图片，验证模型是否真的支持视觉输入…" : "正在请求模型返回测试结果…");
    try {
      const response = await fetch("/api/engine/connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, baseUrl, model, apiKey: apiKey || undefined }),
      });
      const data = await response.json() as { connected?: boolean; verified?: boolean; reply?: string; error?: { message?: string; details?: { reason?: string } } };
      if (!response.ok || !data.connected) throw new Error(data.error?.details?.reason ?? data.error?.message ?? "连接失败");
      setTestStatus(data.verified ? "succeeded" : testStatus);
      setMessage(data.verified ? `已验证并可投入生产：${data.reply ?? model}` : `连接成功：${data.reply ?? model}。请先保存当前填写内容，再测试一次以启用生产。`);
      if (data.verified) onReadinessChanged();
    } catch (error) {
      setFailed(true);
      if (!apiKey) setTestStatus("failed");
      setMessage(error instanceof Error ? error.message : "连接失败");
      if (!apiKey) onReadinessChanged();
    } finally {
      setTesting(false);
    }
  };

  return <article className={`engine-connection-card ${vision ? "" : "required"}`}>
    <div className="engine-card-heading"><div><span>{vision ? "成片质检" : "② 文本智能服务"}</span><h2>{vision ? "视觉连续性质检" : "文本智能服务"}</h2><p>{vision ? "读取片段时间采样图，检查角色形态、场景、动作衔接和分镜覆盖。" : "负责从创意生成剧本，以及理解剧本并形成结构化分集。"}</p></div><i className={testStatus === "succeeded" ? "ready" : testStatus === "failed" ? "failed" : ""}>{testStatus === "succeeded" ? "已验证" : testStatus === "failed" ? "测试失败" : hasCredential ? "待测试" : "未配置"}</i></div>
    <div className="engine-connection-form">
      <label><span>服务名称</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={loading} /></label>
      <label><span>兼容接口地址</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={loading} /></label>
      <label><span>模型</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder={vision ? "支持图片输入的模型" : "模型名称"} disabled={loading} /></label>
      <label><span>API Key</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasCredential ? "已加密保存；留空表示不替换" : "首次配置必须填写"} disabled={loading} /></label>
    </div>
    <div className="engine-card-actions"><span>兼容 OpenAI Chat Completions 接口</span><AppButton onClick={test} disabled={loading || testing || !baseUrl || !model || (!apiKey && !hasCredential)}>{testing ? "测试中…" : vision ? "测试图片识别" : "测试连接"}</AppButton><AppButton primary onClick={save} disabled={loading || saving || !name || !baseUrl || !model || (!apiKey && !hasCredential)}>{saving ? "保存中…" : "保存服务"}</AppButton></div>
    {message && <p className={`engine-connection-message ${failed ? "failed" : ""}`} aria-live="polite">{message}</p>}
  </article>;
}

function SchemaPlaceholderCard() {
  return <article className="engine-connection-card settings-placeholder-card">
    <div className="engine-card-heading"><div><span>可选</span><h2>结构化模板 / Schema</h2><p>用于约束 LLM 输出分集、资产和分镜 JSON 的固定结构。当前版本沿用内置 Schema，后续可在此切换模板。</p></div><i>后期再开</i></div>
  </article>;
}

function ComfyUiServicePanel({ comfy, bridge, connection, bridgeWorkflowCount, testing, onTest }: {
  comfy: EngineResponse["comfy"];
  bridge: BridgeState | null;
  connection: ConnectionState | null;
  bridgeWorkflowCount: number;
  testing: boolean;
  onTest: () => void;
}) {
  return <>
    <article className="engine-connection-card">
      <div className="engine-card-heading"><div><span>③ Spark 地址与密钥</span><h2>Spark / ComfyUI</h2><p>由服务端环境变量配置 ComfyUI 地址与 API Key；此处只检测连接是否可用。</p></div><i className={connection?.connected ? "ready" : ""}>{connection?.connected ? "已连接" : "未连接"}</i></div>
      <dl className="engine-connection-summary"><div><dt>服务地址</dt><dd>{comfy?.serverUrl ?? connection?.serverUrl ?? "尚未配置 COMFYUI_BASE_URL"}</dd></div><div><dt>连接状态</dt><dd>{connection?.message ?? comfy?.message ?? "正在检测…"}</dd></div><div><dt>在线设备</dt><dd>{connection?.connected ? `${connection.deviceCount ?? 0} 个` : "—"}</dd></div></dl>
    </article>
    <article className="engine-connection-card">
      <div className="engine-card-heading"><div><span>③ 桥接器状态</span><h2>小飞象桥接器</h2><p>可视化工作流转 API 执行版；绑定图片/视频能力前需保持桥接器在线。</p></div><i className={bridge?.authorized ? "ready" : bridge?.installed ? "failed" : ""}>{bridge?.authorized ? "已授权" : bridge?.installed ? "需密钥" : "未安装"}</i></div>
      <dl className="engine-connection-summary"><div><dt>版本</dt><dd>{bridge?.version ?? "—"}</dd></div><div><dt>已同步工作流</dt><dd>{bridgeWorkflowCount}</dd></div><div><dt>状态</dt><dd>{bridge?.authorized ? "桥接器已连接，可选择 ComfyUI 工作流" : bridge?.installed ? "桥接器已安装，但密钥不一致" : connection?.connected ? "等待安装桥接器" : "先连接 Spark"}</dd></div></dl>
      <div className="engine-card-actions"><span>检测 Spark 与桥接器</span><AppButton onClick={onTest} disabled={testing}>{testing ? "检测中…" : "检测连接"}</AppButton>{connection?.serverUrl && <a href={connection.serverUrl} target="_blank" rel="noreferrer">打开 ComfyUI ↗</a>}</div>
    </article>
  </>;
}

function EditExportPanel({ runtime }: { runtime: RuntimeStatus }) {
  return <>
    <article className="engine-connection-card engine-runtime-card">
      <div className="engine-card-heading"><div><span>⑦ FFmpeg 媒体处理器</span><h2>剪辑与合成</h2><p>片段合成、整集渲染、字幕烧录和导出都依赖 media-worker。</p></div><i className={runtime.mediaWorker?.connected ? "ready" : ""}>{runtime.mediaWorker?.connected ? "在线" : "未就绪"}</i></div>
      <div className="engine-runtime-services">
        <div><span className={runtime.mediaWorker?.connected ? "ready" : ""} /><div><strong>FFmpeg 媒体处理器</strong><p>{runtime.mediaWorker?.message ?? "正在检测…"}</p></div><small>{runtime.mediaWorker?.serverUrl ?? "http://127.0.0.1:8091"}</small></div>
        <div><span className={runtime.batchRunner?.connected ? "ready" : runtime.batchRunner?.status === "degraded" ? "failed" : ""} /><div><strong>批次执行器</strong><p>{runtime.batchRunner?.message ?? "正在检测…"}</p></div><small>{runtime.batchRunner?.active ? `${runtime.batchRunner.active} 个生产批次` : `心跳 ${heartbeatLabel(runtime.batchRunner?.lastSeenAt)}`}</small></div>
      </div>
      {(!runtime.batchRunner?.connected || !runtime.mediaWorker?.connected) && <p className="engine-runtime-guidance">本地开发请运行 <code>npm run dev</code> 启动完整环境。</p>}
    </article>
    <article className="engine-connection-card settings-placeholder-card">
      <div className="engine-card-heading"><div><span>⑦ 导出预设</span><h2>分辨率 / 字幕样式</h2><p>整集导出默认使用项目画幅；字幕烧录样式将在后续版本开放自定义。</p></div><i>沿用项目预设</i></div>
      <dl className="engine-connection-summary"><div><dt>默认画幅</dt><dd>跟随项目 aspectRatio</dd></div><div><dt>字幕</dt><dd>导出 SRT 侧车文件，可选烧录</dd></div></dl>
    </article>
  </>;
}

export function EngineConnectionsPanel({
  section,
  onReadinessChanged = () => undefined,
  bridge = null,
  connection = null,
  bridgeWorkflowCount = 0,
  testingComfy = false,
  onTestComfy = () => undefined,
}: {
  section: SettingsSection;
  onReadinessChanged?: () => void;
  bridge?: BridgeState | null;
  connection?: ConnectionState | null;
  bridgeWorkflowCount?: number;
  testingComfy?: boolean;
  onTestComfy?: () => void;
}) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [comfy, setComfy] = useState<EngineResponse["comfy"]>(undefined);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus>({});

  useEffect(() => {
    if (!["text", "comfyui", "edit"].includes(section)) return undefined;
    let cancelled = false;
    fetch("/api/engine/connections", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as EngineResponse & { error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "生产服务读取失败");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setConnections(data.connections ?? []);
        setComfy(data.comfy);
      })
      .catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "生产服务读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [section]);

  useEffect(() => {
    if (section !== "edit") return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/engine/runtime", { cache: "no-store" });
        const data = await response.json() as RuntimeStatus & { error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "后台生产状态读取失败");
        if (!cancelled) setRuntime(data);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "后台生产状态读取失败");
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [section]);

  if (section === "text") {
    return <section className="engine-connections" aria-label="文本与剧本">
      {!loading && <ModelConnectionCard kind="llm" saved={connections.find((item) => item.kind === "llm" && item.enabled) ?? null} loading={false} onReadinessChanged={onReadinessChanged} />}
      <SchemaPlaceholderCard />
      {message && <p className="engine-connection-message failed">{message}</p>}
    </section>;
  }

  if (section === "comfyui") {
    return <section className="engine-connections" aria-label="ComfyUI 服务">
      <ComfyUiServicePanel comfy={comfy} bridge={bridge} connection={connection} bridgeWorkflowCount={bridgeWorkflowCount} testing={testingComfy} onTest={onTestComfy} />
      {message && <p className="engine-connection-message failed">{message}</p>}
    </section>;
  }

  if (section === "edit") {
    return <section className="engine-connections" aria-label="剪辑与导出">
      <EditExportPanel runtime={runtime} />
      {message && <p className="engine-connection-message failed">{message}</p>}
    </section>;
  }

  return null;
}
