import { and, eq, inArray, ne } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { canvasEdges, canvasNodes } from "../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };
type CanvasNodeInput = { id: string; nodeType: string; refType?: string | null; refId?: string | null; title: string; content?: unknown; x: number; y: number; width: number; height: number };
type CanvasEdgeInput = { id: string; fromNodeId: string; toNodeId: string; edgeType?: string; label?: string };
type CanvasBody = { nodes?: CanvasNodeInput[]; edges?: CanvasEdgeInput[] };

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const db = getDb();
  const [nodes, edges] = await Promise.all([
    db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
    db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
  ]);
  return json({
    nodes: nodes.map((node) => ({ ...node, content: JSON.parse(node.contentJson) })),
    edges,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<CanvasBody>(request);
  if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) return errorResponse(400, "INVALID_CANVAS", "画布数据不完整");
  if (body.nodes.length > 500 || body.edges.length > 1000) return errorResponse(413, "CANVAS_TOO_LARGE", "单个画布最多包含 500 个节点和 1000 条连线");
  const nodeIds = new Set(body.nodes.map((node) => node.id));
  const edgeIds = new Set(body.edges.map((edge) => edge.id));
  if (nodeIds.size !== body.nodes.length || edgeIds.size !== body.edges.length) return errorResponse(400, "DUPLICATE_CANVAS_ID", "画布包含重复的节点或连线编号");
  if (body.edges.some((edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId))) return errorResponse(400, "INVALID_EDGE", "连线引用了不存在的节点");

  const db = getDb();
  const [foreignNodes, foreignEdges] = await Promise.all([
    body.nodes.length ? db.select({ id: canvasNodes.id }).from(canvasNodes).where(and(inArray(canvasNodes.id, [...nodeIds]), ne(canvasNodes.projectId, projectId))).limit(1) : [],
    body.edges.length ? db.select({ id: canvasEdges.id }).from(canvasEdges).where(and(inArray(canvasEdges.id, [...edgeIds]), ne(canvasEdges.projectId, projectId))).limit(1) : [],
  ]);
  if (foreignNodes.length || foreignEdges.length) return errorResponse(409, "CANVAS_ID_CONFLICT", "画布编号与其他项目冲突，请刷新画布后重试");

  const now = Math.floor(Date.now() / 1000);
  const d1 = getD1();
  const statements: D1PreparedStatement[] = [
    d1.prepare("DELETE FROM canvas_edges WHERE project_id = ?").bind(projectId),
    d1.prepare("DELETE FROM canvas_nodes WHERE project_id = ?").bind(projectId),
  ];
  body.nodes.forEach((node) => statements.push(d1.prepare("INSERT INTO canvas_nodes (id, project_id, node_type, ref_type, ref_id, title, content_json, x, y, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(node.id, projectId, node.nodeType, node.refType ?? null, node.refId ?? null, node.title.slice(0, 120), JSON.stringify(node.content ?? {}), Math.round(node.x), Math.round(node.y), Math.round(node.width), Math.round(node.height), now, now)));
  body.edges.forEach((edge) => statements.push(d1.prepare("INSERT INTO canvas_edges (id, project_id, from_node_id, to_node_id, edge_type, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(edge.id, projectId, edge.fromNodeId, edge.toNodeId, edge.edgeType ?? "reference", (edge.label ?? "内容关联").slice(0, 60), now, now)));
  await d1.batch(statements);
  return json({ saved: true, nodeCount: body.nodes.length, edgeCount: body.edges.length, savedAt: new Date().toISOString() });
}
