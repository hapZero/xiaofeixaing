"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";
import { AppButton, Logo } from "../../components/ui";
import { useStudioAuth } from "../auth/AuthContext";
import type { ProjectProductionDetail, ProjectSummary, View } from "../studio/types";

type FlowNodeKind = "idea" | "role" | "scene" | "prop" | "media" | "shot" | "video";

type FlowNodeData = Record<string, unknown> & {
  kind: FlowNodeKind;
  title: string;
  meta: string;
  stage?: "story" | "assets" | "storyboard" | "production";
  items?: Array<{
    id: string;
    title: string;
    meta: string;
    image?: string;
    status?: "draft" | "ready" | "running" | "failed";
  }>;
  stats?: Array<{ label: string; value: string }>;
  origin?: "user" | "project";
  image?: string;
  status?: "draft" | "ready" | "running" | "failed";
  badge?: string;
  progress?: number;
  refType?: string | null;
  refId?: string | null;
};

type ProductionNode = Node<FlowNodeData, "production">;
type ProductionEdge = Edge<{ relation: string }, "smoothstep">;
type FlowGraph = { nodes: ProductionNode[]; edges: ProductionEdge[] };

const runningSegmentStates = new Set(["preparing", "generating", "generating_shots", "composing", "processing_sound", "mixing", "lip_syncing"]);

function persistedMediaStatus(status: string | null | undefined, hasMedia: boolean): FlowNodeData["status"] {
  if (hasMedia && status === "ready") return "ready";
  if (["queued", "running", "generating", "processing", "uploading"].includes(status ?? "")) return "running";
  if ((status ?? "").includes("fail") || (status ?? "").includes("error")) return "failed";
  return "draft";
}

function segmentRuntimeStatus(status: string, hasVideo: boolean): FlowNodeData["status"] {
  if (hasVideo) return "ready";
  if (runningSegmentStates.has(status)) return "running";
  if (status.includes("fail") || status.includes("error")) return "failed";
  return "draft";
}

function referencedNodeRuntime(detail: ProjectProductionDetail, node: ProductionNode): Partial<FlowNodeData> | null {
  const { refType, refId } = node.data;
  if (!refType || !refId || refType === "project_stage") return null;

  if (refType === "character") {
    const character = detail.characters.find((item) => item.id === refId);
    if (!character) return null;
    const form = detail.characterForms.find((item) => item.characterId === character.id && item.assetId)
      ?? detail.characterForms.find((item) => item.characterId === character.id);
    const assetId = form?.assetId ?? character.assetId;
    const asset = detail.assets.find((item) => item.id === assetId);
    const hasMedia = Boolean(asset?.storageKey || asset?.thumbnailUrl);
    const status = persistedMediaStatus(asset?.status, hasMedia);
    return {
      title: character.canonicalName,
      image: asset?.thumbnailUrl ?? undefined,
      status,
      badge: status === "ready" ? character.voiceLocked ? "形象与音色已就绪" : "角色形象已就绪" : status === "running" ? "角色形象生成中" : status === "failed" ? "角色形象生成失败" : "等待角色标准图",
      progress: status === "ready" ? 100 : status === "running" ? 45 : 0,
    };
  }

  if (refType === "story_scene") {
    const scene = detail.storyScenes.find((item) => item.id === refId);
    if (!scene) return null;
    const asset = detail.assets.find((item) => item.id === scene.assetId);
    const hasMedia = Boolean(asset?.storageKey || asset?.thumbnailUrl);
    const status = persistedMediaStatus(asset?.status, hasMedia);
    return {
      title: scene.name,
      image: asset?.thumbnailUrl ?? undefined,
      status,
      badge: status === "ready" ? scene.audioPresetId ? "场景与声音场已就绪" : "场景标准图已就绪" : status === "running" ? "场景标准图生成中" : status === "failed" ? "场景标准图生成失败" : "等待场景标准图",
      progress: status === "ready" ? 100 : status === "running" ? 45 : 0,
    };
  }

  if (refType === "asset") {
    const asset = detail.assets.find((item) => item.id === refId);
    if (!asset) return null;
    const hasMedia = Boolean(asset.storageKey || asset.thumbnailUrl);
    const status = persistedMediaStatus(asset.status, hasMedia);
    return {
      title: asset.name,
      image: asset.thumbnailUrl ?? undefined,
      status,
      badge: status === "ready" ? "素材已就绪" : status === "running" ? "素材处理中" : status === "failed" ? "素材处理失败" : "等待生成或上传",
      progress: status === "ready" ? 100 : status === "running" ? 45 : 0,
    };
  }

  if (refType === "segment" || refType === "segment_video") {
    const segment = detail.segments.find((item) => item.id === refId);
    if (!segment) return null;
    const segmentShots = detail.shots.filter((shot) => shot.segmentId === segment.id);
    const completedShots = segmentShots.filter((shot) => shot.videoAssetId || shot.firstFrameAssetId).length;
    const videoAsset = detail.assets.find((asset) => asset.id === segment.videoAssetId);
    const firstFrame = segmentShots.map((shot) => detail.assets.find((asset) => asset.id === shot.firstFrameAssetId)).find(Boolean);
    const status = segmentRuntimeStatus(segment.status, Boolean(segment.videoAssetId));
    const progress = segment.videoAssetId ? 100 : segmentShots.length ? Math.round((completedShots / segmentShots.length) * 80) : 0;
    return {
      title: refType === "segment_video" ? `${segment.title} · 当前视频` : segment.title,
      image: videoAsset?.thumbnailUrl ?? firstFrame?.thumbnailUrl ?? undefined,
      status,
      badge: status === "ready" ? `当前采用 V${segment.currentVersionNumber}` : status === "running" ? `片段生产中 · ${completedShots}/${segmentShots.length}` : status === "failed" ? "片段生产失败" : `${segmentShots.length} 个分镜等待生产`,
      progress,
    };
  }

  return null;
}

const nodeLabel: Record<FlowNodeKind, string> = {
  idea: "故事",
  role: "角色",
  scene: "场景",
  prop: "道具",
  media: "素材",
  shot: "片段",
  video: "视频",
};

const nodeSymbol: Record<FlowNodeKind, string> = {
  idea: "文",
  role: "角",
  scene: "景",
  prop: "物",
  media: "素",
  shot: "片",
  video: "▶",
};

const stageLabel: Record<NonNullable<FlowNodeData["stage"]>, string> = {
  story: "01 剧本",
  assets: "02 资产",
  storyboard: "03 分镜",
  production: "04 成片",
};

const allowedConnectionTargets: Record<FlowNodeKind, FlowNodeKind[]> = {
  idea: ["role", "scene", "prop", "shot"],
  role: ["shot"],
  scene: ["shot"],
  prop: ["shot"],
  media: ["role", "scene", "prop", "shot"],
  shot: ["video"],
  video: [],
};

function connectionLabel(source: FlowNodeKind, target: FlowNodeKind) {
  if (target === "shot") return source === "role" ? "角色引用" : source === "scene" ? "场景引用" : source === "prop" ? "道具引用" : source === "media" ? "素材引用" : "故事输入";
  if (source === "shot" && target === "video") return "片段成片";
  if (source === "media") return "形象参考";
  return "内容关联";
}

function productionLayout(nodes: ProductionNode[], edges: ProductionEdge[]) {
  const graph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", align: "UL", ranksep: 110, nodesep: 42, edgesep: 24, marginx: 44, marginy: 44 });

  for (const node of nodes) {
    const width = Number(node.measured?.width ?? node.width ?? node.style?.width ?? 226);
    const height = Number(node.measured?.height ?? node.height ?? node.style?.minHeight ?? 156);
    graph.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  runDagreLayout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
    return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
  });
}

function nodeReferenceKey(node: ProductionNode) {
  return node.data.refType && node.data.refId ? `${node.data.refType}:${node.data.refId}` : null;
}

function makeNode(
  id: string,
  kind: FlowNodeKind,
  title: string,
  meta: string,
  x: number,
  y: number,
  options: Partial<Pick<FlowNodeData, "stage" | "items" | "stats" | "origin" | "image" | "status" | "badge" | "progress" | "refType" | "refId">> & { width?: number; height?: number } = {},
): ProductionNode {
  return {
    id,
    type: "production",
    position: { x, y },
    data: { kind, title, meta, stage: options.stage, items: options.items, stats: options.stats, origin: options.origin, image: options.image, status: options.status ?? "draft", badge: options.badge, progress: options.progress, refType: options.refType, refId: options.refId },
    style: { width: options.width ?? 226, minHeight: options.height ?? 156 },
  };
}

function makeEdge(id: string, source: string, target: string, label: string): ProductionEdge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    label,
    data: { relation: label },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#7581d7" },
    style: { stroke: "#7581d7", strokeWidth: 1.8 },
    labelStyle: { fill: "#666d91", fontSize: 10 },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.96 },
    labelBgPadding: [7, 4],
    labelBgBorderRadius: 8,
  };
}

function blankFlow(): FlowGraph {
  return {
    nodes: [makeNode(crypto.randomUUID(), "idea", "故事灵感", "", 70, 150, { width: 250, height: 150, origin: "user" })],
    edges: [],
  };
}

function projectFlow(detail: ProjectProductionDetail): FlowGraph {
  const visualAssets = detail.assets.filter((asset) => ["character", "scene", "prop", "material"].includes(asset.assetType));
  const readyAssets = visualAssets.filter((asset) => asset.status === "ready" && Boolean(asset.storageKey || asset.thumbnailUrl));
  const readySegments = detail.segments.filter((segment) => segment.videoAssetId);
  const runningSegments = detail.segments.filter((segment) => ["preparing", "generating", "generating_shots", "composing"].includes(segment.status));
  const failedSegments = detail.segments.filter((segment) => segment.status.includes("failed"));
  const storyItems = detail.episodes.slice(0, 5).map((episode) => ({
    id: episode.id,
    title: `第 ${episode.episodeNumber} 集 · ${episode.title}`,
    meta: episode.summary || `${detail.segments.filter((segment) => segment.episodeId === episode.id).length} 个片段`,
    status: "ready" as const,
  }));
  const assetItems = [
    ...detail.characters.map((character) => {
      const asset = detail.assets.find((item) => item.id === character.assetId);
      return { id: character.id, title: character.canonicalName, meta: character.voiceLocked ? "形象与音色已配置" : "角色形态", image: asset?.thumbnailUrl ?? undefined, status: asset?.status === "ready" ? "ready" as const : "draft" as const };
    }),
    ...detail.assets.filter((asset) => ["scene", "prop"].includes(asset.assetType)).map((asset) => ({ id: asset.id, title: asset.name, meta: asset.assetType === "scene" ? "场景" : "道具", image: asset.thumbnailUrl ?? undefined, status: asset.status === "ready" ? "ready" as const : "draft" as const })),
  ].slice(0, 8);
  const segmentItems = detail.segments.slice(0, 8).map((segment) => ({
    id: segment.id,
    title: `片段 ${String(segment.sequence).padStart(2, "0")} · ${segment.title}`,
    meta: `${detail.shots.filter((shot) => shot.segmentId === segment.id).length} 个镜头 · ${Math.round(segment.durationMs / 1_000)} 秒`,
    status: segment.status.includes("failed") ? "failed" as const : runningSegments.some((item) => item.id === segment.id) ? "running" as const : segment.videoAssetId ? "ready" as const : "draft" as const,
  }));
  const resultItems = detail.segments.slice(0, 8).map((segment) => {
    const video = detail.assets.find((asset) => asset.id === segment.videoAssetId);
    return { id: segment.id, title: segment.title, meta: video ? `当前采用 V${segment.currentVersionNumber}` : "等待生成候选", image: video?.thumbnailUrl ?? undefined, status: segment.status.includes("failed") ? "failed" as const : runningSegments.some((item) => item.id === segment.id) ? "running" as const : video ? "ready" as const : "draft" as const };
  });

  const story = makeNode(`stage-story-${detail.project.id}`, "idea", "剧本与分集", detail.project.synopsis || "从故事蓝图进入分集生产", 40, 80, {
    stage: "story", items: storyItems, stats: [{ label: "分集", value: String(detail.episodes.length) }, { label: "片段", value: String(detail.segments.length) }], origin: "project", width: 380, height: 300, status: "ready", badge: "故事结构已入库", progress: 100, refType: "project_stage", refId: `${detail.project.id}:story`,
  });
  const assetProgress = visualAssets.length ? Math.round((readyAssets.length / visualAssets.length) * 100) : 0;
  const assetStage = makeNode(`stage-assets-${detail.project.id}`, "role", "全剧资产", "角色形态、场景和关键道具在这里统一复用", 520, 80, {
    stage: "assets", items: assetItems, stats: [{ label: "角色", value: String(detail.characters.length) }, { label: "场景", value: String(detail.storyScenes.length) }, { label: "已就绪", value: `${readyAssets.length}/${visualAssets.length}` }], origin: "project", width: 500, height: 360, status: readyAssets.length === visualAssets.length && visualAssets.length ? "ready" : "draft", badge: visualAssets.length ? `视觉资产 ${readyAssets.length}/${visualAssets.length}` : "等待提取资产", progress: assetProgress, refType: "project_stage", refId: `${detail.project.id}:assets`,
  });
  const storyboardStage = makeNode(`stage-storyboard-${detail.project.id}`, "shot", "片段与分镜", "按片段组织连续镜头、引用资产和导演指令", 1120, 80, {
    stage: "storyboard", items: segmentItems, stats: [{ label: "片段", value: String(detail.segments.length) }, { label: "镜头", value: String(detail.shots.length) }], origin: "project", width: 520, height: 390, status: failedSegments.length ? "failed" : runningSegments.length ? "running" : detail.segments.length ? "ready" : "draft", badge: failedSegments.length ? `${failedSegments.length} 个片段失败` : runningSegments.length ? `${runningSegments.length} 个片段生产中` : `${detail.segments.length} 个片段已编排`, progress: detail.segments.length ? Math.round((readySegments.length / detail.segments.length) * 100) : 0, refType: "project_stage", refId: `${detail.project.id}:storyboard`,
  });
  const productionStage = makeNode(`stage-production-${detail.project.id}`, "video", "片段生成工作台", "生成提示词、真实任务进度、候选版本和成片选择", 1740, 80, {
    stage: "production", items: resultItems, stats: [{ label: "已完成", value: `${readySegments.length}/${detail.segments.length}` }, { label: "生成中", value: String(runningSegments.length) }, { label: "失败", value: String(failedSegments.length) }], origin: "project", width: 500, height: 390, status: failedSegments.length ? "failed" : runningSegments.length ? "running" : readySegments.length === detail.segments.length && detail.segments.length ? "ready" : "draft", badge: readySegments.length === detail.segments.length && detail.segments.length ? "全部片段已有当前版本" : `片段视频 ${readySegments.length}/${detail.segments.length}`, progress: detail.segments.length ? Math.round((readySegments.length / detail.segments.length) * 100) : 0, refType: "project_stage", refId: `${detail.project.id}:production`,
  });
  [story, assetStage, storyboardStage, productionStage].forEach((node) => {
    node.deletable = false;
  });
  return {
    nodes: [story, assetStage, storyboardStage, productionStage],
    edges: [
      makeEdge(`stage-edge-story-assets-${detail.project.id}`, story.id, assetStage.id, "提取全剧资产"),
      makeEdge(`stage-edge-assets-storyboard-${detail.project.id}`, assetStage.id, storyboardStage.id, "确认引用并编排片段"),
      makeEdge(`stage-edge-storyboard-production-${detail.project.id}`, storyboardStage.id, productionStage.id, "生成片段候选"),
    ],
  };
}

function hydrateRuntimeNodes(current: ProductionNode[], detail: ProjectProductionDetail) {
  const stageNodes = new Map(projectFlow(detail).nodes.flatMap((node) => {
    const key = nodeReferenceKey(node);
    return key ? [[key, node] as const] : [];
  }));
  let changed = false;
  const nodes = current.map((node) => {
    const key = nodeReferenceKey(node);
    const stage = key ? stageNodes.get(key) : undefined;
    const patch = stage?.data ?? referencedNodeRuntime(detail, node);
    if (!patch) return node;
    const data = { ...node.data, ...patch };
    if (JSON.stringify(data) === JSON.stringify(node.data)) return node;
    changed = true;
    return { ...node, data };
  });
  return changed ? nodes : current;
}

function ProductionNodeCard({ data, selected, isConnectable }: NodeProps<ProductionNode>) {
  const canReceive = Boolean(data.stage) || !["idea", "media"].includes(data.kind);
  const canSend = Boolean(data.stage) || data.kind !== "video";
  return (
    <article className={`production-flow-card ${data.kind} ${data.stage ? "stage-card" : ""} ${selected ? "selected" : ""}`}>
      {canReceive && <Handle type="target" position={Position.Left} className="production-flow-handle" isConnectable={Boolean(isConnectable && !data.stage)} />}
      <div className="node-head"><span><i className={`node-symbol ${data.kind}`}>{nodeSymbol[data.kind]}</i>{data.stage ? stageLabel[data.stage] : nodeLabel[data.kind]}</span>{data.stage ? <em>主线阶段</em> : data.refId ? <em>已入库</em> : null}</div>
      {data.image && <div className="flow-node-image" style={{ backgroundImage: `url(${data.image})` }}>{data.kind === "video" && <i>▶</i>}</div>}
      <div className="node-copy"><b>{data.title}</b><p>{data.meta || "等待补充内容"}</p></div>
      {data.stats?.length ? <div className="stage-node-stats">{data.stats.map((item) => <span key={item.label}><b>{item.value}</b><small>{item.label}</small></span>)}</div> : null}
      {data.items?.length ? <div className={`stage-node-items ${data.stage ?? ""}`}>{data.items.map((item) => <div key={item.id} className={item.status ?? "draft"}>{item.image ? <i style={{ backgroundImage: `url(${item.image})` }} /> : <i>{item.status === "ready" ? "✓" : item.status === "running" ? "…" : item.status === "failed" ? "!" : "·"}</i>}<p><b>{item.title}</b><small>{item.meta}</small></p></div>)}</div> : null}
      {data.kind === "role" && !data.stage && <div className="node-state">♬ {data.meta.includes("固定音色") ? "音色已锁定" : "音色待配置"}</div>}
      {(data.badge || typeof data.progress === "number") && <div className={`node-production-state ${data.status ?? "draft"}`}><div><span>{data.badge ?? "等待生产"}</span><b>{Math.round(data.progress ?? 0)}%</b></div><i><em style={{ width: `${Math.max(2, data.progress ?? 0)}%` }} /></i></div>}
      {data.stage && <small className="stage-node-open-hint">双击打开这一阶段</small>}
      {canSend && <Handle type="source" position={Position.Right} className="production-flow-handle" isConnectable={Boolean(isConnectable && !data.stage)} />}
    </article>
  );
}

const nodeTypes = { production: ProductionNodeCard };

function CanvasWorkspace({
  title,
  onClose,
  onContinue,
  continueLabel,
  projectId = null,
}: {
  title: string;
  onClose: () => void;
  onContinue: (target: "assets" | "videos") => void;
  continueLabel: string;
  projectId?: string | null;
}) {
  const { user } = useStudioAuth();
  const accountAvatar = user.displayName.trim().slice(0, 1).toUpperCase() || "飞";
  const initial = useMemo(() => blankFlow(), []);
  const [nodes, setNodes] = useState<ProductionNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ProductionEdge[]>(initial.edges);
  const [selected, setSelected] = useState(initial.nodes[0].id);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [connectionHint, setConnectionHint] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"本地草稿" | "正在载入" | "已自动保存" | "保存中" | "保存失败">(projectId ? "正在载入" : "本地草稿");
  const uploadRef = useRef<HTMLInputElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<ProductionNode, ProductionEdge> | null>(null);
  const connectionSourceRef = useRef<string | null>(null);
  const connectionAcceptedRef = useRef(false);
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[0];

  const focusCanvasContent = useCallback((showAll = false) => {
    const instance = flowInstanceRef.current;
    if (!instance) return;
    const allNodes = instance.getNodes();
    const creativeNodes = allNodes.filter((node) => node.data.origin === "user");
    const focusingCreativeNodes = !showAll && creativeNodes.length > 0;
    const focusNodes = showAll ? allNodes : focusingCreativeNodes ? creativeNodes : allNodes.filter((node) => node.data.stage);
    instance.fitView({ nodes: focusNodes, padding: focusingCreativeNodes ? 0.14 : 0.24, minZoom: showAll ? 0.2 : focusingCreativeNodes ? 0.48 : 0.2, maxZoom: 0.82, duration: 320 });
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<ProductionNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange<ProductionEdge>[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || !allowedConnectionTargets[source.data.kind].includes(target.data.kind)) {
      setError("这两个生产对象不能这样连接。角色、场景、道具和素材应连接到片段，片段再连接到视频结果。");
      return;
    }
    connectionAcceptedRef.current = true;
    setError("");
    setEdges((current) => current.some((edge) => edge.source === connection.source && edge.target === connection.target)
      ? current
      : addEdge(makeEdge(crypto.randomUUID(), connection.source, connection.target, connectionLabel(source.data.kind, target.data.kind)), current));
  }, [nodes]);

  const isValidConnection = useCallback((connection: Connection | ProductionEdge) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    return Boolean(source && target && source.id !== target.id && allowedConnectionTargets[source.data.kind].includes(target.data.kind));
  }, [nodes]);

  const refreshRuntimeState = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("REFRESH_FAILED");
      const detail = await response.json() as ProjectProductionDetail;
      setNodes((current) => hydrateRuntimeNodes(current, detail));
      if (!silent) setError("");
    } catch {
      if (!silent) setError("生产状态刷新失败，请检查服务连接后重试。");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/projects/${projectId}/canvas`, { cache: "no-store" }),
      fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
    ]).then(async ([canvasResponse, projectResponse]) => {
      if (!canvasResponse.ok || !projectResponse.ok) throw new Error("LOAD_FAILED");
      return { canvas: await canvasResponse.json() as { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }, detail: await projectResponse.json() as ProjectProductionDetail };
    }).then(({ canvas: data, detail }) => {
      if (cancelled) return;
      if (data.nodes?.length) {
        const generated = projectFlow(detail);
        const runtimeNodes = new Map(
          generated.nodes.flatMap((node) => {
            const key = nodeReferenceKey(node);
            return key ? [[key, node] as const] : [];
          }),
        );
        const loadedNodes = data.nodes.map((item) => makeNode(
          String(item.id),
          String(item.nodeType) as FlowNodeKind,
          String(item.title),
          String((item.content as { meta?: unknown } | undefined)?.meta ?? ""),
          Number(item.x),
          Number(item.y),
          (() => {
            const storedRefType = typeof item.refType === "string" ? item.refType : null;
            const refType = String(item.nodeType) === "video" && storedRefType === "segment" ? "segment_video" : storedRefType;
            const refId = typeof item.refId === "string" ? item.refId : null;
            const runtime = refType && refId ? runtimeNodes.get(`${refType}:${refId}`) : undefined;
            return {
            width: Number(item.width),
            height: Number(item.height),
            stage: runtime?.data.stage,
            items: runtime?.data.items,
            stats: runtime?.data.stats,
            origin: runtime?.data.origin ?? ((item.content as { origin?: unknown } | undefined)?.origin === "user" ? "user" : undefined),
            image: runtime?.data.image ?? (typeof (item.content as { image?: unknown } | undefined)?.image === "string" ? String((item.content as { image?: unknown }).image) : undefined),
            status: runtime?.data.status ?? (["draft", "ready", "running", "failed"].includes(String((item.content as { status?: unknown } | undefined)?.status)) ? String((item.content as { status?: unknown }).status) as FlowNodeData["status"] : "draft"),
            badge: runtime?.data.badge ?? (typeof (item.content as { badge?: unknown } | undefined)?.badge === "string" ? String((item.content as { badge?: unknown }).badge) : undefined),
            progress: runtime?.data.progress ?? (typeof (item.content as { progress?: unknown } | undefined)?.progress === "number" ? Number((item.content as { progress?: unknown }).progress) : undefined),
            refType,
            refId,
            };
          })(),
        ));
        const hydratedNodes = hydrateRuntimeNodes(loadedNodes, detail);
        const customNodes = hydratedNodes.filter((node) => node.data.origin === "user");
        const uniqueNodeByReference = new Map(generated.nodes.flatMap((node) => {
          const key = nodeReferenceKey(node);
          return key ? [[key, node] as const] : [];
        }));
        const stageNodes = [...uniqueNodeByReference.values()].map((runtime) => {
          const stored = hydratedNodes.find((node) => nodeReferenceKey(node) === nodeReferenceKey(runtime));
          return stored ? { ...runtime, position: stored.position } : runtime;
        });
        const mergedNodes = [...stageNodes, ...customNodes];
        const retainedIds = new Set(mergedNodes.map((node) => node.id));
        const loadedEdges = (data.edges ?? [])
          .map((item) => makeEdge(
            String(item.id),
            String(item.fromNodeId),
            String(item.toNodeId),
            String(item.label ?? "内容关联"),
          ))
          .filter((edge) => retainedIds.has(edge.source) && retainedIds.has(edge.target));
        const generatedEdges = generated.edges;
        const mergedEdges = [...loadedEdges];
        generatedEdges.forEach((edge) => {
          if (!mergedEdges.some((item) => item.source === edge.source && item.target === edge.target && item.label === edge.label)) mergedEdges.push(edge);
        });
        setNodes(mergedNodes);
        setEdges(mergedEdges);
        setSelected(mergedNodes[0].id);
      } else {
        const generated = projectFlow(detail);
        setNodes(generated.nodes);
        setEdges(generated.edges);
        setSelected(generated.nodes[0].id);
      }
      window.setTimeout(() => {
        focusCanvasContent();
      }, 100);
      setPersistenceReady(true);
      setSaveState("已自动保存");
    }).catch(() => { if (!cancelled) setSaveState("保存失败"); });
    return () => { cancelled = true; };
  }, [focusCanvasContent, projectId]);

  useEffect(() => {
    if (!projectId || !persistenceReady) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRuntimeState(true);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [persistenceReady, projectId, refreshRuntimeState]);

  const serializedCanvas = useCallback(() => ({
    nodes: nodes.map((node) => ({
      id: node.id,
      nodeType: node.data.kind,
      refType: node.data.refType,
      refId: node.data.refId,
      title: node.data.title,
      content: { meta: node.data.meta, stage: node.data.stage, items: node.data.items, stats: node.data.stats, origin: node.data.origin, image: node.data.image, status: node.data.status, badge: node.data.badge, progress: node.data.progress },
      x: node.position.x,
      y: node.position.y,
      width: Number(node.width ?? node.style?.width ?? 226),
      height: Number(node.height ?? node.style?.minHeight ?? 156),
    })),
    edges: edges.map((edge) => ({ id: edge.id, fromNodeId: edge.source, toNodeId: edge.target, label: String(edge.label ?? "内容关联"), edgeType: "reference" })),
  }), [edges, nodes]);

  useEffect(() => {
    if (!projectId || !persistenceReady) return;
    const timer = window.setTimeout(() => {
      setSaveState("保存中");
      fetch(`/api/projects/${projectId}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serializedCanvas()),
      }).then((response) => { if (!response.ok) throw new Error("SAVE_FAILED"); setSaveState("已自动保存"); }).catch(() => setSaveState("保存失败"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [persistenceReady, projectId, serializedCanvas]);

  const addNode = (kind: FlowNodeKind) => {
    const count = nodes.filter((node) => node.data.kind === kind).length + 1;
    const labels: Record<FlowNodeKind, [string, string]> = {
      idea: ["新故事段落", "在右侧填写灵感、剧本或创作要求"],
      role: [`新角色 ${count}`, "待上传形象与绑定音色"],
      scene: [`新场景 ${count}`, "待生成场景标准图"],
      prop: [`新道具 ${count}`, "待补充道具设定"],
      media: [`新素材 ${count}`, "等待上传图片、视频或音频"],
      shot: [`新片段 ${count}`, "连接角色、场景与素材后组织连续分镜"],
      video: [`新视频 ${count}`, "连接片段后生成候选视频"],
    };
    const node = makeNode(crypto.randomUUID(), kind, labels[kind][0], labels[kind][1], 590 + count * 28, 260 + count * 24, { width: ["scene", "shot", "video"].includes(kind) ? 244 : 220, height: kind === "idea" || kind === "prop" ? 138 : 204, origin: "user" });
    setNodes((current) => [...current, node]);
    setSelected(node.id);
  };

  const uploadMaterial = async (file: File | undefined) => {
    if (!file || !projectId) return;
    setError("");
    setSaveState("保存中");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/projects/${projectId}/assets/upload`, { method: "POST", body: form });
      const data = await response.json() as { asset?: { id: string; name: string; thumbnailUrl: string | null }; mediaType?: string; error?: { message?: string } };
      if (!response.ok || !data.asset) throw new Error(data.error?.message ?? "素材上传失败");
      const node = makeNode(crypto.randomUUID(), "media", data.asset.name, `已上传${data.mediaType === "image" ? "图片" : data.mediaType === "video" ? "视频" : "音频"}素材`, 600 + nodes.length * 12, 250 + nodes.length * 10, { width: 220, height: 180, origin: "user", image: data.mediaType === "image" ? data.asset.thumbnailUrl ?? undefined : undefined, refType: "asset", refId: data.asset.id });
      setNodes((current) => [...current, node]);
      setSelected(node.id);
      setSaveState("已自动保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "素材上传失败");
      setSaveState("保存失败");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const copySelectedNode = () => {
    if (!selectedNode || selectedNode.data.stage) return;
    const copy: ProductionNode = { ...selectedNode, id: crypto.randomUUID(), selected: false, position: { x: selectedNode.position.x + 32, y: selectedNode.position.y + 32 }, data: { ...selectedNode.data, title: `${selectedNode.data.title} 副本`, refType: null, refId: null } };
    setNodes((current) => [...current, copy]);
    setSelected(copy.id);
  };

  const deleteSelectedNode = () => {
    if (!selectedNode || selectedNode.data.stage) return;
    if (nodes.length === 1) {
      const replacement = blankFlow().nodes[0];
      setNodes([replacement]);
      setEdges([]);
      setSelected(replacement.id);
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    const next = nodes.find((node) => node.id !== selectedNode.id);
    if (next) setSelected(next.id);
  };

  const materializeCanvas = async () => {
    if (!projectId || materializing) return;
    setMaterializing(true);
    setError("");
    try {
      const saveResponse = await fetch(`/api/projects/${projectId}/canvas`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(serializedCanvas()) });
      if (!saveResponse.ok) throw new Error("画布保存失败");
      const response = await fetch(`/api/projects/${projectId}/canvas/materialize`, { method: "POST" });
      const data = await response.json() as { target?: "assets" | "videos"; refs?: Record<string, { refType: string; refId: string }>; error?: { message?: string } };
      if (!response.ok || !data.target) throw new Error(data.error?.message ?? "画布整理失败");
      if (data.refs) setNodes((current) => current.map((node) => data.refs?.[node.id] ? { ...node, data: { ...node.data, ...data.refs[node.id] } } : node));
      onContinue(data.target);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "画布整理失败");
    } finally {
      setMaterializing(false);
    }
  };

  const updateSelected = (patch: Partial<Pick<FlowNodeData, "title" | "meta">>) => {
    if (!selectedNode || selectedNode.data.stage) return;
    setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const autoLayout = () => {
    setNodes((current) => productionLayout(current, edges));
    window.setTimeout(() => {
      focusCanvasContent(true);
    }, 50);
    setError("");
  };

  return (
    <div className="flow-workspace">
      <header className="flow-topbar">
        <div className="flow-title"><button onClick={onClose} aria-label="返回">←</button><Logo /><span>/</span><div><b>{title}</b><small>{saveState}{saveState === "已自动保存" ? " · 刚刚" : ""}</small></div></div>
        <div className="flow-top-actions"><span className="flow-collaborator" title={user.email}><i>{accountAvatar}</i> {user.displayName} · 仅自己</span><button className="flow-layout-button" type="button" disabled={refreshing || !projectId} onClick={() => void refreshRuntimeState()} title="同步素材、片段和生成任务的最新状态">{refreshing ? "刷新中…" : "刷新状态"}</button><button className="flow-layout-button" type="button" onClick={autoLayout} title="按生产顺序自动整理节点">自动布局</button><AppButton primary disabled={materializing || !projectId} onClick={() => void materializeCanvas()}>{materializing ? "正在整理项目…" : continueLabel}</AppButton></div>
      </header>
      <div className={`flow-body ${libraryOpen ? "library-open" : "library-closed"}`}>
        <aside className="flow-toolbar">
          <button className={libraryOpen ? "active" : ""} onClick={() => setLibraryOpen(!libraryOpen)}><b>◇</b><span>节点</span></button>
          <button onClick={() => addNode("idea")}><b>T</b><span>文本</span></button>
          <button onClick={() => uploadRef.current?.click()}><b>⇧</b><span>上传</span></button>
          <div />
          <button className={helpOpen ? "active" : ""} onClick={() => setHelpOpen((current) => !current)}><b>?</b><span>帮助</span></button>
          <input ref={uploadRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={(event) => void uploadMaterial(event.target.files?.[0])} />
        </aside>
        {libraryOpen && <aside className="flow-library">
          <div className="flow-library-head"><div><small>生产对象</small><h3>添加到画布</h3></div><button onClick={() => setLibraryOpen(false)}>×</button></div>
          <section><label>故事结构</label><button onClick={() => addNode("idea")}><i className="node-symbol idea">文</i><div><b>故事文本</b><span>灵感、剧本或创作要求</span></div><em>＋</em></button><button onClick={() => addNode("shot")}><i className="node-symbol shot">片</i><div><b>片段生产</b><span>组织多个连续分镜</span></div><em>＋</em></button></section>
          <section><label>项目资产</label><button onClick={() => addNode("role")}><i className="node-symbol role">角</i><div><b>角色资产</b><span>形象、形态与固定音色</span></div><em>＋</em></button><button onClick={() => addNode("scene")}><i className="node-symbol scene">景</i><div><b>场景资产</b><span>地点、时间与声音场</span></div><em>＋</em></button><button onClick={() => addNode("prop")}><i className="node-symbol prop">物</i><div><b>道具资产</b><span>保持关键物件一致</span></div><em>＋</em></button></section>
          <section><label>输出</label><button onClick={() => addNode("video")}><i className="node-symbol video">▶</i><div><b>片段视频</b><span>连接片段后生成候选版本</span></div><em>＋</em></button></section>
          <div className="flow-tip"><b>直接拖线连接</b><p>从节点右侧端口拖到目标节点左侧端口。支持平移、滚轮缩放、框选和键盘删除。</p></div>
        </aside>}
        <main className={`flow-stage ${libraryOpen ? "library-visible" : ""}`}>
          {helpOpen && <div className="connect-banner canvas-help"><span>画布上的节点是真实生产对象；角色、场景和素材连接到片段后，会成为该片段的生成引用。</span><button onClick={() => setHelpOpen(false)}>知道了</button></div>}
          {connectionHint && !error && <div className="connect-banner canvas-connect-hint"><span>{connectionHint}</span></div>}
          {error && <div className="connect-banner canvas-error"><span>{error}</span><button onClick={() => setError("")}>关闭</button></div>}
          <ReactFlow<ProductionNode, ProductionEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => { flowInstanceRef.current = instance; }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onConnectStart={(_, params) => {
              connectionSourceRef.current = params.nodeId;
              connectionAcceptedRef.current = false;
              const source = nodes.find((node) => node.id === params.nodeId);
              if (!source) return;
              const targets = allowedConnectionTargets[source.data.kind].map((kind) => nodeLabel[kind]);
              setConnectionHint(targets.length ? `${source.data.title} 可连接到：${targets.join("、")}` : `${source.data.title} 已是最终输出，不能继续向后连接`);
            }}
            onConnectEnd={() => {
              if (connectionSourceRef.current && !connectionAcceptedRef.current) setError("未建立连接。请从节点右侧圆点拖到允许的目标节点左侧圆点。");
              connectionSourceRef.current = null;
              connectionAcceptedRef.current = false;
              setConnectionHint("");
            }}
            onNodeClick={(_, node) => setSelected(node.id)}
            onNodeDoubleClick={(_, node) => {
              if (!node.data.stage) return;
              onContinue(node.data.stage === "assets" ? "assets" : "videos");
            }}
            onPaneClick={() => setSelected("")}
            onNodesDelete={(deleted) => setEdges((current) => current.filter((edge) => !deleted.some((node) => node.id === edge.source || node.id === edge.target)))}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.6}
            defaultEdgeOptions={{ type: "smoothstep" }}
            deleteKeyCode={["Backspace", "Delete"]}
            selectionOnDrag
            panOnScroll
            snapToGrid
            snapGrid={[12, 12]}
            connectionRadius={28}
            connectionLineStyle={{ stroke: "#6673df", strokeWidth: 2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1.2} color="#d3d6df" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(node) => node.data.kind === "role" ? "#88a9d6" : node.data.kind === "scene" ? "#77b59f" : node.data.kind === "video" ? "#7385d9" : "#a49ad8"} />
          </ReactFlow>
        </main>
        <aside className="flow-inspector">
          {selectedNode ? <>
            <div className="inspector-title"><div><small>{selectedNode.data.refId ? "已连接项目数据" : "画布草稿节点"}</small><h3>{selectedNode.data.title}</h3></div></div>
            <div className="inspector-preview" style={selectedNode.data.image ? { backgroundImage: `url(${selectedNode.data.image})` } : undefined}>{!selectedNode.data.image && <span>{selectedNode.data.kind === "idea" ? "文" : "✦"}</span>}</div>
            <label>节点名称<input disabled={Boolean(selectedNode.data.stage)} value={selectedNode.data.title} onChange={(event) => updateSelected({ title: event.target.value })} /></label>
            <label>{selectedNode.data.stage ? "阶段说明" : "内容与导演要求"}<textarea disabled={Boolean(selectedNode.data.stage)} value={selectedNode.data.meta} onChange={(event) => updateSelected({ meta: event.target.value })} /></label>
            <div className="inspector-section"><label>输入引用</label><div className="input-relations">{edges.filter((edge) => edge.target === selectedNode.id).length ? edges.filter((edge) => edge.target === selectedNode.id).map((edge) => <div className="input-relation" key={edge.id}><span>↳ {nodes.find((node) => node.id === edge.source)?.data.title}<small>{String(edge.label ?? "内容关联")}</small></span>{!selectedNode.data.stage && <button type="button" aria-label={`断开 ${String(edge.label ?? "内容关联")}`} onClick={() => setEdges((current) => current.filter((item) => item.id !== edge.id))}>×</button>}</div>) : <p>尚未连接输入对象</p>}</div></div>
            <div className="inspector-section"><label>输出关系</label><div className="input-relations">{edges.filter((edge) => edge.source === selectedNode.id).length ? edges.filter((edge) => edge.source === selectedNode.id).map((edge) => <div className="input-relation" key={edge.id}><span>→ {nodes.find((node) => node.id === edge.target)?.data.title}<small>{String(edge.label ?? "内容关联")}</small></span>{!selectedNode.data.stage && <button type="button" aria-label={`断开 ${String(edge.label ?? "内容关联")}`} onClick={() => setEdges((current) => current.filter((item) => item.id !== edge.id))}>×</button>}</div>) : <p>尚未连接输出对象</p>}</div></div>
            {selectedNode.data.stage
              ? <div className="inspector-actions"><AppButton onClick={autoLayout}>整理画布</AppButton><AppButton primary onClick={() => onContinue(selectedNode.data.stage === "assets" ? "assets" : "videos")}>{selectedNode.data.stage === "assets" ? "打开资产库" : selectedNode.data.stage === "production" ? "进入片段工作台" : "查看分集生产"}</AppButton></div>
              : <div className="inspector-actions three"><AppButton onClick={deleteSelectedNode}>删除</AppButton><AppButton onClick={copySelectedNode}>复制</AppButton><AppButton primary disabled={materializing || !projectId} onClick={() => void materializeCanvas()}>加入生产</AppButton></div>}
          </> : <div className="canvas-empty-inspector"><b>未选择节点</b><p>选择画布中的生产对象后，可在这里编辑内容与查看输入引用。</p></div>}
        </aside>
      </div>
    </div>
  );
}

export function CanvasOverlay({ onClose, onContinue, projectId, title = "短剧资产" }: { onClose: () => void; onContinue: () => void; projectId?: string | null; title?: string }) {
  return <CanvasWorkspace title={`${title} · 资产画布`} projectId={projectId} onClose={onClose} onContinue={() => onContinue()} continueLabel="确认资产，进入分镜 →" />;
}

export function FreeCanvasPage({ onNavigate, project }: { onNavigate: (view: View) => void; project?: ProjectSummary | null }) {
  if (!project) return <div className="flow-workspace"><div className="missing-project"><b>请先创建一个自由画布项目</b><p>自由画布是独立创作路径，不会自动写入示例人物或剧情。</p><AppButton primary onClick={() => onNavigate("drama")}>创建自由画布项目</AppButton></div></div>;
  return <CanvasWorkspace title={`自由画布 · ${project.title}`} projectId={project.id} onClose={() => onNavigate("drama")} onContinue={(target) => onNavigate(target)} continueLabel="整理为短剧项目 →" />;
}
