"use client";

import { useEffect, useRef, useState } from "react";
import { AppButton, Logo } from "../../components/ui";
import { roleImages, sceneImages, videoImages } from "../studio/media";
import type { View } from "../studio/types";

type FlowNode = {
  id: string;
  kind: "idea" | "role" | "scene" | "prop" | "shot" | "video";
  title: string;
  meta: string;
  image?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FlowEdge = { id: string; from: string; to: string; label: string };

const initialFlowNodes: FlowNode[] = [
  { id: "idea", kind: "idea", title: "故事灵感", meta: "旧教室里，一封迟到十七年的信让两个人再次相遇。", x: 40, y: 120, width: 230, height: 146 },
  { id: "linwei", kind: "role", title: "林微 · 成年时期", meta: "主角 · 已绑定固定音色", image: roleImages[0], x: 330, y: 54, width: 204, height: 226 },
  { id: "chenyi", kind: "role", title: "陈屹 · 成年时期", meta: "主角 · 克制低沉男声", image: roleImages[1], x: 330, y: 330, width: 204, height: 226 },
  { id: "school", kind: "scene", title: "废弃的旧教室", meta: "日 · 内 · 午后逆光", image: sceneImages[0], x: 620, y: 170, width: 224, height: 218 },
  { id: "letter", kind: "prop", title: "未寄出的旧信", meta: "关键道具 · 贯穿第 1–3 集", x: 630, y: 460, width: 210, height: 138 },
  { id: "shot", kind: "shot", title: "片段 01 · 重逢", meta: "首帧已生成 · 16:9", image: videoImages[0], x: 920, y: 208, width: 232, height: 226 },
  { id: "video", kind: "video", title: "片段 01 · 动态视频", meta: "V3 · 00:15 · 含原生声音", image: videoImages[1], x: 1240, y: 208, width: 232, height: 226 },
];

const initialFlowEdges: FlowEdge[] = [
  { id: "e1", from: "idea", to: "linwei", label: "提取角色" },
  { id: "e2", from: "idea", to: "chenyi", label: "提取角色" },
  { id: "e3", from: "linwei", to: "school", label: "角色引用" },
  { id: "e4", from: "chenyi", to: "school", label: "同场人物" },
  { id: "e5", from: "school", to: "shot", label: "生成首帧" },
  { id: "e6", from: "letter", to: "shot", label: "道具引用" },
  { id: "e7", from: "shot", to: "video", label: "图生视频" },
];

function FlowCanvasLines({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(parent.clientWidth, 1510);
      const height = parent.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      edges.forEach((edge) => {
        const source = nodes.find((node) => node.id === edge.from);
        const target = nodes.find((node) => node.id === edge.to);
        if (!source || !target) return;
        const startX = source.x + source.width;
        const startY = source.y + source.height / 2;
        const endX = target.x;
        const endY = target.y + target.height / 2;
        const bend = Math.max(70, Math.abs(endX - startX) * 0.48);
        const gradient = context.createLinearGradient(startX, startY, endX, endY);
        gradient.addColorStop(0, "rgba(102, 116, 226, .92)");
        gradient.addColorStop(1, "rgba(149, 157, 222, .88)");
        context.beginPath();
        context.moveTo(startX, startY);
        context.bezierCurveTo(startX + bend, startY, endX - bend, endY, endX, endY);
        context.lineWidth = 8;
        context.strokeStyle = "rgba(91, 104, 196, .1)";
        context.stroke();
        context.beginPath();
        context.moveTo(startX, startY);
        context.bezierCurveTo(startX + bend, startY, endX - bend, endY, endX, endY);
        context.lineWidth = 2;
        context.strokeStyle = gradient;
        context.stroke();
        context.beginPath();
        context.arc(endX - 5, endY, 4, 0, Math.PI * 2);
        context.fillStyle = "#7a85df";
        context.fill();

        const labelX = (startX + endX) / 2;
        const labelY = (startY + endY) / 2;
        context.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
        const labelWidth = context.measureText(edge.label).width + 18;
        context.fillStyle = "rgba(255, 255, 255, .98)";
        context.beginPath();
        context.roundRect(labelX - labelWidth / 2, labelY - 11, labelWidth, 22, 11);
        context.fill();
        context.strokeStyle = "rgba(142, 151, 219, .42)";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#666d91";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(edge.label, labelX, labelY + .5);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [edges, nodes]);

  return <canvas ref={canvasRef} className="flow-lines" aria-hidden="true" />;
}

function CanvasWorkspace({
  title,
  onClose,
  onContinue,
  continueLabel,
  projectId = null,
}: {
  title: string;
  onClose: () => void;
  onContinue: () => void;
  continueLabel: string;
  projectId?: string | null;
}) {
  const [nodes, setNodes] = useState(initialFlowNodes);
  const [edges, setEdges] = useState(initialFlowEdges);
  const [selected, setSelected] = useState("shot");
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [zoom, setZoom] = useState(82);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [saveState, setSaveState] = useState<"本地草稿" | "正在载入" | "已自动保存" | "保存中" | "保存失败">(projectId ? "正在载入" : "本地草稿");
  const dragRef = useRef<{ id: string; dx: number; dy: number; parent: HTMLElement } | null>(null);
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[0];

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/canvas`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("LOAD_FAILED")))
      .then((data: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }) => {
        if (cancelled) return;
        if (data.nodes?.length) {
          setNodes(data.nodes.map((item) => ({
            id: String(item.id),
            kind: String(item.nodeType) as FlowNode["kind"],
            title: String(item.title),
            meta: String((item.content as { meta?: unknown } | undefined)?.meta ?? ""),
            image: typeof (item.content as { image?: unknown } | undefined)?.image === "string" ? String((item.content as { image?: unknown }).image) : undefined,
            x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height),
          })));
          setEdges((data.edges ?? []).map((item) => ({ id: String(item.id), from: String(item.fromNodeId), to: String(item.toNodeId), label: String(item.label ?? "内容关联") })));
        }
        setPersistenceReady(true);
        setSaveState("已自动保存");
      })
      .catch(() => { if (!cancelled) setSaveState("保存失败"); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !persistenceReady) return;
    const timer = window.setTimeout(() => {
      setSaveState("保存中");
      fetch(`/api/projects/${projectId}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodes: nodes.map((node) => ({ id: node.id, nodeType: node.kind, title: node.title, content: { meta: node.meta, image: node.image }, x: node.x, y: node.y, width: node.width, height: node.height })),
          edges: edges.map((edge) => ({ id: edge.id, fromNodeId: edge.from, toNodeId: edge.to, label: edge.label, edgeType: "reference" })),
        }),
      }).then((response) => { if (!response.ok) throw new Error("SAVE_FAILED"); setSaveState("已自动保存"); }).catch(() => setSaveState("保存失败"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [edges, nodes, persistenceReady, projectId]);

  const addNode = (kind: FlowNode["kind"]) => {
    const count = nodes.filter((node) => node.kind === kind).length + 1;
    const labels: Record<FlowNode["kind"], [string, string]> = {
      idea: ["新故事段落", "双击编辑故事内容"],
      role: [`新角色 ${count}`, "待上传形象与绑定音色"],
      scene: [`新场景 ${count}`, "待生成场景标准图"],
      prop: [`新道具 ${count}`, "待补充道具设定"],
      shot: [`新分镜 ${count}`, "等待引用资产生成"],
      video: [`新视频 ${count}`, "等待分镜生成视频"],
    };
    const node: FlowNode = {
      id: `${kind}-${Date.now()}`,
      kind,
      title: labels[kind][0],
      meta: labels[kind][1],
      x: 590 + count * 28,
      y: 260 + count * 24,
      width: kind === "scene" || kind === "shot" || kind === "video" ? 244 : 220,
      height: kind === "idea" || kind === "prop" ? 138 : 204,
    };
    setNodes((current) => [...current, node]);
    setSelected(node.id);
  };

  const connectTo = (targetId: string) => {
    if (!connectingFrom || connectingFrom === targetId) return;
    const exists = edges.some((edge) => edge.from === connectingFrom && edge.to === targetId);
    if (!exists) setEdges((current) => [...current, { id: `edge-${Date.now()}`, from: connectingFrom, to: targetId, label: "内容关联" }]);
    setConnectingFrom(null);
    setSelected(targetId);
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>, node: FlowNode) => {
    if ((event.target as HTMLElement).closest("button")) return;
    setSelected(node.id);
    const parent = event.currentTarget.offsetParent as HTMLElement | null;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    dragRef.current = {
      id: node.id,
      dx: event.clientX - bounds.left + parent.scrollLeft - node.x,
      dy: event.clientY - bounds.top + parent.scrollTop - node.y,
      parent,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragNode = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const { id, dx, dy, parent } = dragRef.current;
    const bounds = parent.getBoundingClientRect();
    const x = event.clientX - bounds.left + parent.scrollLeft - dx;
    const y = event.clientY - bounds.top + parent.scrollTop - dy;
    setNodes((current) => current.map((node) => node.id === id ? { ...node, x: Math.max(20, x), y: Math.max(20, y) } : node));
  };

  return (
    <div className="flow-workspace">
      <header className="flow-topbar">
        <div className="flow-title"><button onClick={onClose} aria-label="返回">←</button><Logo /><span>/</span><div><b>{title}</b><small>{saveState}{saveState === "已自动保存" ? " · 刚刚" : ""}</small></div></div>
        <div className="flow-top-actions"><button className="flow-collaborator"><i>Z</i> 仅自己</button><button>↶</button><button>↷</button><AppButton primary onClick={onContinue}>{continueLabel}</AppButton></div>
      </header>
      <div className="flow-body">
        <aside className="flow-toolbar">
          <button className={libraryOpen ? "active" : ""} onClick={() => setLibraryOpen(!libraryOpen)}><b>◇</b><span>节点</span></button>
          <button><b>T</b><span>文本</span></button>
          <button><b>⇧</b><span>上传</span></button>
          <button><b>✦</b><span>AI生成</span></button>
          <div />
          <button><b>?</b><span>帮助</span></button>
        </aside>
        {libraryOpen && <aside className="flow-library">
          <div className="flow-library-head"><div><small>节点素材库</small><h3>添加到画布</h3></div><button onClick={() => setLibraryOpen(false)}>×</button></div>
          <div className="flow-search">⌕ 搜索角色、场景、内容…</div>
          <section><label>故事结构</label><button onClick={() => addNode("idea")}><i className="node-symbol idea">文</i><div><b>故事文本</b><span>灵感、剧本或分镜描述</span></div><em>＋</em></button><button onClick={() => addNode("shot")}><i className="node-symbol shot">镜</i><div><b>分镜节点</b><span>组织镜头与画面提示词</span></div><em>＋</em></button></section>
          <section><label>资产</label><button onClick={() => addNode("role")}><i className="node-symbol role">角</i><div><b>角色资产</b><span>形象、形态与固定音色</span></div><em>＋</em></button><button onClick={() => addNode("scene")}><i className="node-symbol scene">景</i><div><b>场景资产</b><span>地点、时间与光照</span></div><em>＋</em></button><button onClick={() => addNode("prop")}><i className="node-symbol prop">物</i><div><b>道具资产</b><span>保持关键物件一致</span></div><em>＋</em></button></section>
          <section><label>输出</label><button onClick={() => addNode("video")}><i className="node-symbol video">▶</i><div><b>视频生成</b><span>连接分镜后生成动态结果</span></div><em>＋</em></button></section>
          <div className="flow-tip"><b>连接节点</b><p>点击节点右侧输出点，再点击目标节点左侧输入点。</p></div>
        </aside>}
        <main className={`flow-stage ${libraryOpen ? "library-visible" : ""}`}>
          <FlowCanvasLines nodes={nodes} edges={edges} />
          {connectingFrom && <div className="connect-banner"><span className="pulse-dot" />正在连接：请选择目标节点左侧的输入点 <button onClick={() => setConnectingFrom(null)}>取消</button></div>}
          {nodes.map((node) => (
            <article
              key={node.id}
              className={`flow-node ${node.kind} ${selected === node.id ? "selected" : ""}`}
              style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
              onPointerDown={(event) => beginDrag(event, node)}
              onPointerMove={dragNode}
              onPointerUp={() => { dragRef.current = null; }}
              onClick={() => setSelected(node.id)}
            >
              <button className={`flow-port input ${connectingFrom ? "ready" : ""}`} aria-label={`连接到${node.title}`} onClick={(event) => { event.stopPropagation(); connectTo(node.id); }} />
              <div className="node-head"><span><i className={`node-symbol ${node.kind}`}>{node.kind === "role" ? "角" : node.kind === "scene" ? "景" : node.kind === "prop" ? "物" : node.kind === "shot" ? "镜" : node.kind === "video" ? "▶" : "文"}</i>{node.kind === "role" ? "角色" : node.kind === "scene" ? "场景" : node.kind === "prop" ? "道具" : node.kind === "shot" ? "分镜" : node.kind === "video" ? "视频" : "故事"}</span><button aria-label="节点菜单">•••</button></div>
              {node.image && <div className="flow-node-image" style={{ backgroundImage: `url(${node.image})` }}>{node.kind === "video" && <i>▶</i>}</div>}
              <div className="node-copy"><b>{node.title}</b><p>{node.meta}</p></div>
              {node.kind === "idea" && <div className="idea-tags"><span>#校园</span><span>#重逢</span><span>#悬疑</span></div>}
              {node.kind === "role" && <div className="node-state">♬ 音色已锁定</div>}
              <button className="flow-port output" aria-label={`从${node.title}建立连接`} onClick={(event) => { event.stopPropagation(); setConnectingFrom(node.id); setSelected(node.id); }} />
            </article>
          ))}
          <div className="flow-zoom"><button>⌖</button><button onClick={() => setZoom(Math.max(40, zoom - 10))}>−</button><span>{zoom}%</span><button onClick={() => setZoom(Math.min(140, zoom + 10))}>＋</button></div>
          <div className="flow-minimap">{nodes.map((node) => <i key={node.id} style={{ left: node.x / 12, top: node.y / 10 }} />)}<b /></div>
        </main>
        <aside className="flow-inspector">
          <div className="inspector-title"><div><small>节点设置</small><h3>{selectedNode.title}</h3></div><button>×</button></div>
          <div className="inspector-preview" style={selectedNode.image ? { backgroundImage: `url(${selectedNode.image})` } : undefined}>{!selectedNode.image && <span>{selectedNode.kind === "idea" ? "文" : "✦"}</span>}</div>
          <label>节点名称<input value={selectedNode.title} onChange={(event) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, title: event.target.value } : node))} /></label>
          <label>内容提示词<textarea value={selectedNode.meta} onChange={(event) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, meta: event.target.value } : node))} /></label>
          <div className="inspector-section"><label>输入引用</label><div className="input-relations">{edges.filter((edge) => edge.to === selectedNode.id).length ? edges.filter((edge) => edge.to === selectedNode.id).map((edge) => <span key={edge.id}>↳ {nodes.find((node) => node.id === edge.from)?.title}</span>) : <p>尚未连接输入节点</p>}</div></div>
          <div className="inspector-actions"><AppButton>复制节点</AppButton><AppButton primary>生成新版本</AppButton></div>
        </aside>
      </div>
    </div>
  );
}

export function CanvasOverlay({ onClose, onContinue }: { onClose: () => void; onContinue: () => void }) {
  return <CanvasWorkspace title="旧教室的第三排 · 资产画布" onClose={onClose} onContinue={onContinue} continueLabel="确认资产，进入分镜 →" />;
}

export function FreeCanvasPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ensureProject = async () => {
      const listResponse = await fetch("/api/projects", { cache: "no-store" });
      if (!listResponse.ok) return;
      const list = await listResponse.json() as { projects?: Array<{ id: string; sourceType: string; title: string }> };
      const existing = list.projects?.find((project) => project.sourceType === "canvas" && project.title === "校园悬疑灵感");
      if (existing) { if (!cancelled) setProjectId(existing.id); return; }
      const createResponse = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "校园悬疑灵感", sourceType: "canvas", synopsis: "旧教室里，一封迟到十七年的信让两个人再次相遇。" }) });
      if (!createResponse.ok) return;
      const created = await createResponse.json() as { project?: { id: string } };
      if (!cancelled && created.project?.id) setProjectId(created.project.id);
    };
    ensureProject().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return <CanvasWorkspace title="自由画布 · 校园悬疑灵感" projectId={projectId} onClose={() => onNavigate("home")} onContinue={() => onNavigate("drama")} continueLabel="整理为短剧项目 →" />;
}

