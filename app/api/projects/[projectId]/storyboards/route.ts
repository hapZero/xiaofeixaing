import { eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { assets, audioPresets, episodes, shots } from "../../../../../db/schema";
import { errorResponse, json } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { createStoryboardDrafts } from "../../../../lib/server/storyboard-drafts";

type RouteContext = { params: Promise<{ projectId: string }> };

function presetSceneAssetId(configJson: string): string | null {
  try {
    const config = JSON.parse(configJson) as { sceneAssetId?: unknown };
    return typeof config.sceneAssetId === "string" ? config.sceneAssetId : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const projectEpisodes = await db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber);
  if (!projectEpisodes.length) return errorResponse(409, "EPISODES_REQUIRED", "项目还没有分集剧本");
  const existingShots = await db.select().from(shots).where(inArray(shots.episodeId, projectEpisodes.map((episode) => episode.id)));
  if (existingShots.length) return json({ created: 0, shots: existingShots.length, reused: true });

  const [sceneAssets, presets] = await Promise.all([
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(audioPresets).where(eq(audioPresets.projectId, projectId)),
  ]);
  const scenes = sceneAssets.filter((asset) => asset.assetType === "scene");
  const presetBySceneName = new Map<string, string>();
  for (const preset of presets) {
    const sceneId = presetSceneAssetId(preset.configJson);
    const scene = scenes.find((asset) => asset.id === sceneId);
    if (scene) presetBySceneName.set(scene.name, preset.id);
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let created = 0;
  for (const episode of projectEpisodes) {
    const drafts = createStoryboardDrafts(episode.scriptText ?? "");
    drafts.forEach((draft, index) => {
      const environmentPresetId = draft.sceneName ? presetBySceneName.get(draft.sceneName) ?? null : null;
      statements.push(
        getD1().prepare("INSERT INTO shots (id, episode_id, sequence, title, prompt, duration_ms, status, environment_preset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), episode.id, index + 1, draft.title, draft.prompt, draft.durationMs, "draft", environmentPresetId, now, now),
      );
      created += 1;
    });
  }
  if (!created) return errorResponse(409, "SCRIPT_REQUIRED", "分集剧本没有可拆分的内容");
  statements.push(getD1().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind("storyboarding", now, projectId, user.id));
  await getD1().batch(statements);
  return json({ created, shots: created, reused: false });
}
