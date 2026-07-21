import { errorResponse, json } from "../../lib/server/http";
import { getRequestUser } from "../../lib/server/request-user";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  return json({ user });
}
