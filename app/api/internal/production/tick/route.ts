import { env } from "cloudflare:workers";
import { errorResponse, json } from "../../../../lib/server/http";
import { runActiveEpisodeBatches } from "../../../../lib/server/episode-batch-runner";
import { runActiveGenerationJobs } from "../../../../lib/server/generation-job-reconciler";
import { runActiveVisualAssetBatches } from "../../../../lib/server/visual-asset-batch-runner";
import { recordRuntimeHeartbeat } from "../../../../lib/server/runtime-heartbeats";

type RuntimeEnv = { BATCH_RUNNER_TOKEN?: string };
const localToken = "xiaofeixiang-local-batch-runner";

function configuredToken(request: Request) {
  const configured = (env as unknown as RuntimeEnv).BATCH_RUNNER_TOKEN?.trim();
  if (configured) return configured;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" ? localToken : null;
}

export async function POST(request: Request) {
  const expected = configuredToken(request);
  if (!expected) return errorResponse(503, "BATCH_RUNNER_NOT_CONFIGURED", "后台批次执行器尚未配置内部令牌");
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return errorResponse(401, "BATCH_RUNNER_UNAUTHORIZED", "后台批次执行器认证失败");
  const instanceId = request.headers.get("x-runner-instance")?.trim().slice(0, 120) || "unknown-runner";
  const mode = request.headers.get("x-runner-mode") === "scheduled" ? "scheduled" : "continuous";
  try {
    const generationJobs = await runActiveGenerationJobs();
    const [episodes, visualAssets] = await Promise.all([runActiveEpisodeBatches(), runActiveVisualAssetBatches()]);
    const active = generationJobs.active + episodes.active + visualAssets.active;
    await recordRuntimeHeartbeat({ service: "production-runner", instanceId, status: "online", details: { mode, active, generationJobs, episodes, visualAssets } });
    return json({ active, generationJobs, episodes, visualAssets });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "BATCH_RUNNER_FAILED";
    try {
      await recordRuntimeHeartbeat({ service: "production-runner", instanceId, status: "degraded", details: { mode, message: reason } });
    } catch {
      // The original production failure remains the useful response when heartbeat persistence also fails.
    }
    return errorResponse(500, "BATCH_RUNNER_FAILED", "后台批次推进失败", { reason });
  }
}
