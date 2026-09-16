import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { assets, audioPresets, storyScenes } from "../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { invalidateEnvironmentPresetSound } from "../../../../lib/server/sound-invalidation";

type RouteContext = { params: Promise<{ projectId: string }> };
type UpsertPresetBody = { sceneAssetId?: string; description?: string; locked?: boolean };

function sceneAssetId(configJson: string): string | null {
  try {
    const value = (JSON.parse(configJson) as { sceneAssetId?: unknown }).sceneAssetId;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<UpsertPresetBody>(request);
  const sceneId = body?.sceneAssetId?.trim();
  const description = body?.description?.trim();
  if (!sceneId || !description) return errorResponse(400, "SOUND_PRESET_INVALID", "请选择场景并描述持续存在的环境声音");
  const db = getDb();
  const sceneAsset = (await db.select().from(assets).where(and(eq(assets.id, sceneId), eq(assets.projectId, projectId), eq(assets.assetType, "scene"))).limit(1))[0];
  if (!sceneAsset) return errorResponse(404, "SCENE_ASSET_NOT_FOUND", "场景资产不存在或无权访问");
  const presets = await db.select().from(audioPresets).where(and(eq(audioPresets.projectId, projectId), eq(audioPresets.presetType, "ambience")));
  const existing = presets.find((preset) => sceneAssetId(preset.configJson) === sceneId) ?? null;
  const now = new Date();
  const presetId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    const nextDescription = description.slice(0, 2_000);
    const soundChanged = existing.description !== nextDescription;
    await db.update(audioPresets).set({ name: `${sceneAsset.name} · 环境声音场`, description: nextDescription, assetId: soundChanged ? null : existing.assetId, locked: body?.locked ?? true, updatedAt: now }).where(eq(audioPresets.id, existing.id));
    if (soundChanged) await invalidateEnvironmentPresetSound(projectId, existing.id, now);
  } else {
    await db.insert(audioPresets).values({ id: presetId, projectId, presetType: "ambience", name: `${sceneAsset.name} · 环境声音场`, description: description.slice(0, 2_000), assetId: null, configJson: JSON.stringify({ sceneAssetId: sceneId, continuousAcrossScene: true }), locked: body?.locked ?? true, createdAt: now, updatedAt: now });
  }
  await db.update(storyScenes).set({ audioPresetId: presetId, updatedAt: now }).where(and(eq(storyScenes.projectId, projectId), eq(storyScenes.assetId, sceneId)));
  const preset = (await db.select().from(audioPresets).where(eq(audioPresets.id, presetId)).limit(1))[0];
  return json({ preset }, { status: existing ? 200 : 201 });
}
