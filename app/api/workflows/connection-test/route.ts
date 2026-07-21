import { comfyUiConfigured, getComfyUiServerUrl, testComfyUiConnection } from "../../../lib/server/comfyui";
import { errorResponse, json } from "../../../lib/server/http";
import { getRequestUser } from "../../../lib/server/request-user";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  if (!comfyUiConfigured()) return json({ configured: false, connected: false, serverUrl: null, message: "尚未设置 ComfyUI 服务地址" });
  try {
    const result = await testComfyUiConnection();
    return json({ configured: true, ...result, serverUrl: getComfyUiServerUrl(), message: "Spark 工作引擎连接正常" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "COMFYUI_CONNECTION_FAILED";
    return json({ configured: true, connected: false, serverUrl: getComfyUiServerUrl(), message: "无法连接 Spark 工作引擎", reason });
  }
}
