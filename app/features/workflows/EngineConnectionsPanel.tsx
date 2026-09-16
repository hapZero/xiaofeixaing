"use client";

import { useEffect, useState } from "react";
import { AppButton } from "../../components/ui";

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
    <div className="engine-card-heading"><div><span>{vision ? "成片质检" : "必需"}</span><h2>{vision ? "视觉连续性质检" : "文本智能"}</h2><p>{vision ? "读取片段时间采样图，检查角色形态、场景、动作衔接和分镜覆盖。必须使用支持图片输入的模型。" : "负责从创意生成剧本，以及理解剧本并形成结构化分集。"}</p></div><i className={testStatus === "succeeded" ? "ready" : testStatus === "failed" ? "failed" : ""}>{testStatus === "succeeded" ? "已验证" : testStatus === "failed" ? "测试失败" : hasCredential ? "待测试" : "未配置"}</i></div>
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

export function EngineConnectionsPanel({ onReadinessChanged = () => undefined }: { onReadinessChanged?: () => void }) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [comfy, setComfy] = useState<EngineResponse["comfy"]>(undefined);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus>({});

  useEffect(() => {
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
  }, []);

  useEffect(() => {
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
  }, []);

  return <section className="engine-connections" aria-label="生产服务连接">
    {!loading && <ModelConnectionCard kind="llm" saved={connections.find((item) => item.kind === "llm" && item.enabled) ?? null} loading={false} onReadinessChanged={onReadinessChanged} />}
    {!loading && <ModelConnectionCard kind="vision" saved={connections.find((item) => item.kind === "vision" && item.enabled) ?? null} loading={false} onReadinessChanged={onReadinessChanged} />}
    <article className="engine-connection-card">
      <div className="engine-card-heading"><div><span>媒体生成</span><h2>Spark / ComfyUI</h2><p>负责角色、场景、分镜画面与视频；具体生产方案在下方配置。</p></div><i className={comfy?.connected ? "ready" : ""}>{loading ? "检测中" : comfy?.connected ? "已连接" : "未连接"}</i></div>
      <dl className="engine-connection-summary"><div><dt>服务地址</dt><dd>{comfy?.serverUrl ?? "服务器尚未配置 COMFYUI_BASE_URL"}</dd></div><div><dt>状态</dt><dd>{comfy?.message ?? "正在检测…"}</dd></div></dl>
      {message && <p className="engine-connection-message failed">{message}</p>}
    </article>
    <article className="engine-connection-card engine-runtime-card">
      <div className="engine-card-heading"><div><span>生产基础设施</span><h2>后台生产</h2><p>片段批量生成、失败恢复、整集合成和导出不会依赖浏览器页面保持打开。</p></div><i className={runtime.batchRunner?.connected && runtime.mediaWorker?.connected ? "ready" : runtime.batchRunner?.status === "degraded" ? "failed" : ""}>{runtime.batchRunner?.connected && runtime.mediaWorker?.connected ? "全部在线" : "未就绪"}</i></div>
      <div className="engine-runtime-services">
        <div><span className={runtime.batchRunner?.connected ? "ready" : runtime.batchRunner?.status === "degraded" ? "failed" : ""} /><div><strong>批次执行器</strong><p>{runtime.batchRunner?.message ?? "正在检测…"}</p></div><small>{runtime.batchRunner?.active ? `${runtime.batchRunner.active} 个生产批次` : `心跳 ${heartbeatLabel(runtime.batchRunner?.lastSeenAt)}`}</small></div>
        <div><span className={runtime.mediaWorker?.connected ? "ready" : ""} /><div><strong>FFmpeg 媒体处理器</strong><p>{runtime.mediaWorker?.message ?? "正在检测…"}</p></div><small>{runtime.mediaWorker?.serverUrl ?? "http://127.0.0.1:8091"}</small></div>
      </div>
      {(!runtime.batchRunner?.connected || !runtime.mediaWorker?.connected) && <p className="engine-runtime-guidance">本地开发请在项目目录运行 <code>npm run dev</code> 启动完整环境；只运行 <code>npm run dev:web</code> 只能打开页面，后台任务不会推进。</p>}
    </article>
  </section>;
}
