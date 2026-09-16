import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { serviceConnections } from "../../../../../db/schema";
import { decryptCredential } from "../../../../lib/server/credentials";
import { errorResponse, json, readJson } from "../../../../lib/server/http";
import { testLlmConnection, testVisionConnection } from "../../../../lib/server/llm";
import { getRequestUser } from "../../../../lib/server/request-user";
import { writeServiceTestMetadata } from "../../../../lib/service-readiness";

type TestBody = { kind?: "llm" | "vision"; baseUrl?: string; model?: string; apiKey?: string };

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const body = await readJson<TestBody>(request);
  const kind = body?.kind === "vision" ? "vision" : "llm";
  const existing = (await getDb().select().from(serviceConnections).where(and(
    eq(serviceConnections.ownerId, user.id),
    eq(serviceConnections.kind, kind),
  )).limit(1))[0];
  const baseUrl = body?.baseUrl?.trim() || existing?.baseUrl;
  const model = body?.model?.trim() || existing?.model;
  let apiKey = body?.apiKey?.trim() || "";
  if (!apiKey && existing?.secretCiphertext) {
    try { apiKey = await decryptCredential(existing.secretCiphertext); }
    catch (error) { return errorResponse(503, "CREDENTIAL_DECRYPT_FAILED", "无法读取已保存的 API Key", { reason: error instanceof Error ? error.message : "UNKNOWN" }); }
  }
  if (!baseUrl || !model || !apiKey) return errorResponse(400, "CONNECTION_INCOMPLETE", "请先填写服务地址、模型和 API Key");
  const testingSavedConfiguration = Boolean(existing && !body?.apiKey?.trim() && baseUrl === existing.baseUrl && model === existing.model);
  try {
    const result = kind === "vision"
      ? await testVisionConnection({ name: existing?.name ?? "视觉质检", provider: "openai-compatible", baseUrl, model, apiKey })
      : await testLlmConnection({ name: existing?.name ?? "文本智能", provider: "openai-compatible", baseUrl, model, apiKey });
    if (existing && testingSavedConfiguration) {
      const testedAt = new Date();
      await getDb().update(serviceConnections).set({ configJson: writeServiceTestMetadata(existing.configJson, { lastTestStatus: "succeeded", lastTestedAt: testedAt.toISOString(), lastTestError: null }), updatedAt: testedAt }).where(eq(serviceConnections.id, existing.id));
    }
    return json({ connected: true, verified: testingSavedConfiguration, ...result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "LLM_CONNECTION_FAILED";
    if (existing && testingSavedConfiguration) {
      const testedAt = new Date();
      await getDb().update(serviceConnections).set({ configJson: writeServiceTestMetadata(existing.configJson, { lastTestStatus: "failed", lastTestedAt: testedAt.toISOString(), lastTestError: reason }), updatedAt: testedAt }).where(eq(serviceConnections.id, existing.id));
    }
    return errorResponse(502, kind === "vision" ? "VISION_CONNECTION_FAILED" : "LLM_CONNECTION_FAILED", kind === "vision" ? "视觉质检服务连接失败" : "文本智能服务连接失败", { reason });
  }
}
