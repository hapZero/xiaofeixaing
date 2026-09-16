import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { serviceConnections } from "../../../../db/schema";
import { encryptCredential } from "../../../lib/server/credentials";
import { comfyUiConfigured, getComfyUiServerUrl, testComfyUiConnection } from "../../../lib/server/comfyui";
import { errorResponse, json, readJson } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";
import { readServiceTestMetadata, writeServiceTestMetadata } from "../../../lib/service-readiness";

type SaveConnectionBody = {
  kind?: "llm" | "vision";
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled?: boolean;
};

function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const rows = await getDb().select().from(serviceConnections).where(eq(serviceConnections.ownerId, user.id));
  let comfy = { configured: comfyUiConfigured(), connected: false, serverUrl: comfyUiConfigured() ? getComfyUiServerUrl() : null, message: "尚未配置 ComfyUI" };
  if (comfy.configured) {
    try {
      const result = await testComfyUiConnection();
      comfy = { configured: true, connected: result.connected, serverUrl: getComfyUiServerUrl(), message: result.connected ? "Spark / ComfyUI 连接正常" : "Spark / ComfyUI 无法连接" };
    } catch {
      comfy = { configured: true, connected: false, serverUrl: getComfyUiServerUrl(), message: "Spark / ComfyUI 无法连接" };
    }
  }
  return json({
    connections: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      hasCredential: Boolean(row.secretCiphertext),
      enabled: row.enabled,
      ...readServiceTestMetadata(row.configJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    comfy,
  });
}

export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await readJson<SaveConnectionBody>(request);
  if (!body?.kind || !["llm", "vision"].includes(body.kind)) return errorResponse(400, "CONNECTION_KIND_INVALID", "只支持配置文本智能或视觉质检服务");
  const kind = body.kind;
  const baseUrl = normalizedHttpUrl(body.baseUrl ?? "");
  const name = body.name?.trim().slice(0, 80);
  const provider = body.provider?.trim().slice(0, 40) || "openai-compatible";
  const model = body.model?.trim().slice(0, 120);
  if (!name || !baseUrl || !model) return errorResponse(400, "CONNECTION_INVALID", "请填写服务名称、有效地址和模型名称");

  const db = getDb();
  const existing = (await db.select().from(serviceConnections).where(and(
    eq(serviceConnections.ownerId, user.id),
    eq(serviceConnections.kind, kind),
  )).limit(1))[0];
  if (!existing?.secretCiphertext && !body.apiKey?.trim()) return errorResponse(400, "CREDENTIAL_REQUIRED", "首次配置必须填写 API Key");
  let secretCiphertext = existing?.secretCiphertext ?? null;
  if (body.apiKey?.trim()) {
    try {
      secretCiphertext = await encryptCredential(body.apiKey.trim());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "CREDENTIAL_ENCRYPTION_FAILED";
      return errorResponse(503, "CREDENTIAL_ENCRYPTION_UNAVAILABLE", "服务器尚未配置凭据加密密钥", { reason });
    }
  }
  const now = new Date();
  const configJson = writeServiceTestMetadata(existing?.configJson, {
    lastTestStatus: "invalidated",
    lastTestedAt: null,
    lastTestError: null,
  });
  const values = { name, provider, baseUrl, model, secretCiphertext, configJson, enabled: body.enabled ?? true, updatedAt: now };
  if (existing) await db.update(serviceConnections).set(values).where(eq(serviceConnections.id, existing.id));
  else await db.insert(serviceConnections).values({ id: crypto.randomUUID(), ownerId: user.id, kind, ...values, createdAt: now });
  const saved = (await db.select().from(serviceConnections).where(and(eq(serviceConnections.ownerId, user.id), eq(serviceConnections.kind, kind))).limit(1))[0];
  return json({ connection: { id: saved.id, kind: saved.kind, name: saved.name, provider: saved.provider, baseUrl: saved.baseUrl, model: saved.model, hasCredential: Boolean(saved.secretCiphertext), enabled: saved.enabled, ...readServiceTestMetadata(saved.configJson) } });
}
