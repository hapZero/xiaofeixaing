import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { assets, characters, episodes } from "../../../../../db/schema";
import { errorResponse, json } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { extractScriptAssets } from "../../../../lib/server/script-assets";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) {
    return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  }

  const db = getDb();
  const [projectEpisodes, existingAssets, existingCharacters] = await Promise.all([
    db.select().from(episodes).where(eq(episodes.projectId, projectId)),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
  ]);
  const script = projectEpisodes.map((episode) => episode.scriptText ?? "").join("\n");
  if (!script.trim()) return errorResponse(409, "SCRIPT_REQUIRED", "请先完善并保存分集剧本");

  const extracted = extractScriptAssets(script);
  const existingAssetKeys = new Set(existingAssets.map((asset) => `${asset.assetType}:${asset.name}`));
  const existingCharacterNames = new Set(existingCharacters.map((character) => character.canonicalName));
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let createdCharacters = 0;
  let createdScenes = 0;
  let createdProps = 0;

  for (const name of extracted.characters) {
    if (existingCharacterNames.has(name)) continue;
    const assetId = crypto.randomUUID();
    const characterId = crypto.randomUUID();
    statements.push(
      getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(assetId, projectId, null, "character", name, "extracted", JSON.stringify({ source: "script" }), now, now),
      getD1().prepare("INSERT INTO characters (id, project_id, asset_id, canonical_name, profile_json, voice_description, voice_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(characterId, projectId, assetId, name, "{}", null, false, now, now),
    );
    createdCharacters += 1;
  }

  for (const name of extracted.scenes) {
    if (existingAssetKeys.has(`scene:${name}`)) continue;
    const assetId = crypto.randomUUID();
    statements.push(
      getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(assetId, projectId, null, "scene", name, "extracted", JSON.stringify({ source: "script" }), now, now),
      getD1().prepare("INSERT INTO audio_presets (id, project_id, preset_type, name, description, asset_id, config_json, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), projectId, "environment", `${name} · 环境音`, "请描述该场景持续存在的底噪、空间混响和标志性环境声。", null, JSON.stringify({ sceneAssetId: assetId }), false, now, now),
    );
    createdScenes += 1;
  }

  for (const name of extracted.props) {
    if (existingAssetKeys.has(`prop:${name}`)) continue;
    statements.push(
      getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), projectId, null, "prop", name, "extracted", JSON.stringify({ source: "script" }), now, now),
    );
    createdProps += 1;
  }

  statements.push(
    getD1().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind("assets", now, projectId, user.id),
  );
  await getD1().batch(statements);
  return json({
    extracted,
    created: { characters: createdCharacters, scenes: createdScenes, props: createdProps },
  });
}
