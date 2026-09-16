import { errorResponse, json } from "../../../lib/server/http";
import { testMediaWorkerConnection } from "../../../lib/server/media-worker";
import { getRequestUser } from "../../../lib/server/request-user";
import { readRuntimeHeartbeat } from "../../../lib/server/runtime-heartbeats";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");

  const [runner, mediaWorker] = await Promise.all([
    readRuntimeHeartbeat("production-runner"),
    testMediaWorkerConnection(),
  ]);
  const runnerOnline = runner?.fresh === true && runner.status === "online";
  const runnerDegraded = runner?.fresh === true && runner.status === "degraded";
  return json({
    batchRunner: {
      connected: runnerOnline,
      status: runnerOnline ? "online" : runnerDegraded ? "degraded" : "offline",
      mode: runner?.details.mode ?? null,
      active: runner?.details.active ?? 0,
      lastSeenAt: runner?.lastSeenAt ?? null,
      message: runnerOnline
        ? runner?.details.mode === "scheduled" ? "定时生产执行器在线" : "持续生产执行器在线"
        : runnerDegraded ? runner?.details.message || "后台生产执行器运行异常"
          : runner ? "后台生产执行器心跳已中断" : "尚未收到后台生产执行器心跳",
    },
    mediaWorker,
  });
}
