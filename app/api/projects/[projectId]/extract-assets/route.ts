import { waitUntil } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { assets, characterForms, characters, episodes, generationJobs, projects, storyBibles, storyScenes } from "../../../../../db/schema";
import { summarizeVideoCapabilitiesForPrompt } from "../../../../lib/workflow-capabilities";
import { analyzeDramaScript, getLlmConnection } from "../../../../lib/server/llm";
import { errorResponse, json } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { effectiveVerifiedCapabilities, getWorkflowBindingReadiness } from "../../../../lib/server/verified-workflows";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");

  const db = getDb();
  const [projectEpisodes, existingAssets, existingCharacters, existingBible, existingStoryScenes] = await Promise.all([
    db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1),
    db.select().from(storyScenes).where(eq(storyScenes.projectId, projectId)),
  ]);
  const existingForms = existingCharacters.length
    ? await db.select().from(characterForms).where(inArray(characterForms.characterId, existingCharacters.map((character) => character.id)))
    : [];
  const script = projectEpisodes.map((episode) => episode.scriptText ?? "").join("\n");
  if (!script.trim()) return errorResponse(409, "SCRIPT_REQUIRED", "请先完善并保存分集剧本");
  const incompleteEpisodes = projectEpisodes.filter((episode) => !episode.scriptText?.trim());
  if (incompleteEpisodes.length) return errorResponse(409, "EPISODE_SCRIPT_INCOMPLETE", `还有 ${incompleteEpisodes.length} 集没有完整剧本，不能提前进入资产提取`);

  const connection = await getLlmConnection(user.id).catch(() => null);
  if (!connection) return errorResponse(409, "LLM_REQUIRED", "需要先在设置中保存并真实测试文本智能服务，才能理解剧本并提取真实资产");

  const activeJob = (await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, user.id),
    eq(generationJobs.projectId, projectId),
    eq(generationJobs.entityType, "project"),
    eq(generationJobs.entityId, projectId),
    eq(generationJobs.capability, "llm_analysis"),
    inArray(generationJobs.status, ["queued", "running"]),
  )).limit(1))[0];
  if (activeJob) return json({ job: activeJob, reused: true }, { status: 202 });

  const textJobId = crypto.randomUUID();
  const jobStartedAt = new Date();
  await db.insert(generationJobs).values({
    id: textJobId,
    ownerId: user.id,
    projectId,
    entityType: "project",
    entityId: projectId,
    capability: "llm_analysis",
    workflowBindingId: null,
    status: "running",
    payloadJson: JSON.stringify({ episodeCount: projectEpisodes.length, sourceType: project.sourceType }),
    startedAt: jobStartedAt,
    createdAt: jobStartedAt,
    updatedAt: jobStartedAt,
  });
  await db.update(episodes).set({ status: "confirmed", updatedAt: jobStartedAt }).where(eq(episodes.projectId, projectId));
  await db.update(projects).set({ status: "asset_extraction", updatedAt: jobStartedAt }).where(eq(projects.id, projectId));

  const { verifiedBindings } = await getWorkflowBindingReadiness(user.id);
  const configuredVideo = effectiveVerifiedCapabilities(verifiedBindings);

  waitUntil((async () => {
    const heartbeatTextJob = async () => {
      await db.update(generationJobs).set({ updatedAt: new Date() }).where(eq(generationJobs.id, textJobId));
    };
    try {
      await heartbeatTextJob();
      const heartbeatTimer = setInterval(() => { void heartbeatTextJob(); }, 60_000);

  let analysis: Awaited<ReturnType<typeof analyzeDramaScript>>;
  try {
    analysis = await analyzeDramaScript(connection, {
      title: project.title,
      stylePreset: project.stylePreset,
      aspectRatio: project.aspectRatio,
      availableVideoCapabilities: summarizeVideoCapabilitiesForPrompt(configuredVideo),
      episodes: projectEpisodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        summary: episode.summary,
        scriptText: episode.scriptText ?? "",
      })),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "LLM_ANALYSIS_FAILED";
    throw new Error(reason);
  } finally {
    clearInterval(heartbeatTimer);
  }

  const existingAssetByKey = new Map(existingAssets.map((asset) => [`${asset.assetType}:${asset.name}`, asset]));
  const existingCharacterByName = new Map(existingCharacters.map((character) => [character.canonicalName, character]));
  const existingSceneByName = new Map(existingStoryScenes.map((scene) => [scene.name, scene]));
  const now = Math.floor(Date.now() / 1_000);
  const nextSourceRevision = (existingBible[0]?.sourceRevision ?? 0) + 1;
  const statements: D1PreparedStatement[] = [];
  let createdCharacters = 0;
  let createdScenes = 0;
  let createdProps = 0;

  for (const character of analysis.characters) {
    let characterId = existingCharacterByName.get(character.name)?.id ?? null;
    let characterAssetId = existingCharacterByName.get(character.name)?.assetId ?? null;
    if (!characterId) {
      characterId = crypto.randomUUID();
      characterAssetId = crypto.randomUUID();
      statements.push(
        getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, source_revision, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(characterAssetId, projectId, null, "character", nextSourceRevision, character.name, "extracted", JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: character.description, episodeNumbers: character.episodeNumbers }), now, now),
        getD1().prepare("INSERT INTO characters (id, project_id, asset_id, canonical_name, profile_json, voice_description, voice_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(characterId, projectId, characterAssetId, character.name, JSON.stringify({ description: character.description, episodeNumbers: character.episodeNumbers }), character.voiceDescription || null, false, now, now),
      );
      createdCharacters += 1;
    } else {
      if (!characterAssetId) {
        characterAssetId = crypto.randomUUID();
        statements.push(
          getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, source_revision, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(characterAssetId, projectId, null, "character", nextSourceRevision, character.name, "extracted", JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: character.description, episodeNumbers: character.episodeNumbers }), now, now),
          getD1().prepare("UPDATE characters SET asset_id = ? WHERE id = ? AND project_id = ?").bind(characterAssetId, characterId, projectId),
        );
      } else {
        statements.push(
          getD1().prepare("UPDATE assets SET source_revision = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND project_id = ?")
            .bind(nextSourceRevision, JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: character.description, episodeNumbers: character.episodeNumbers }), now, characterAssetId, projectId),
        );
      }
      statements.push(
        getD1().prepare("UPDATE characters SET profile_json = ?, voice_description = CASE WHEN voice_locked = 1 THEN voice_description ELSE ? END, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(JSON.stringify({ description: character.description, episodeNumbers: character.episodeNumbers }), character.voiceDescription || null, now, characterId, projectId),
      );
    }

    const characterExistingForms = existingForms.filter((form) => form.characterId === characterId);
    for (const form of character.forms) {
      const existingForm = characterExistingForms.find((item) => item.name === form.name);
      if (existingForm) {
        const baseAssetId = form.name === "基础形象" ? characterAssetId : null;
        statements.push(
          getD1().prepare("UPDATE character_forms SET description = ?, episode_scope_json = ?, asset_id = COALESCE(?, asset_id), updated_at = ? WHERE id = ? AND character_id = ?")
            .bind(form.description, JSON.stringify(form.episodeNumbers), baseAssetId, now, existingForm.id, characterId),
        );
        if (baseAssetId) statements.push(
          getD1().prepare("UPDATE character_form_references SET asset_id = ?, reference_type = 'primary', is_primary = 1, updated_at = ? WHERE character_form_id = ? AND reference_order = 0").bind(baseAssetId, now, existingForm.id),
          getD1().prepare("INSERT OR IGNORE INTO character_form_references (id, character_form_id, asset_id, reference_type, reference_order, is_primary, created_at, updated_at) VALUES (?, ?, ?, 'primary', 0, 1, ?, ?)").bind(crypto.randomUUID(), existingForm.id, baseAssetId, now, now),
        );
        continue;
      }
      const formId = crypto.randomUUID();
      const baseAssetId = form.name === "基础形象" ? characterAssetId : null;
      statements.push(
        getD1().prepare("INSERT INTO character_forms (id, character_id, name, description, asset_id, episode_scope_json, inherit_voice, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(formId, characterId, form.name, form.description, baseAssetId, JSON.stringify(form.episodeNumbers), true, now, now),
      );
      if (baseAssetId) statements.push(
        getD1().prepare("INSERT INTO character_form_references (id, character_form_id, asset_id, reference_type, reference_order, is_primary, created_at, updated_at) VALUES (?, ?, ?, 'primary', 0, 1, ?, ?)").bind(crypto.randomUUID(), formId, baseAssetId, now, now),
      );
    }
  }

  for (const scene of analysis.scenes) {
    let assetId = existingAssetByKey.get(`scene:${scene.name}`)?.id ?? null;
    if (!assetId) {
      assetId = crypto.randomUUID();
      statements.push(
        getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, source_revision, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(assetId, projectId, null, "scene", nextSourceRevision, scene.name, "extracted", JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: scene.description, episodeNumbers: scene.episodeNumbers }), now, now),
      );
      createdScenes += 1;
    } else {
      statements.push(
        getD1().prepare("UPDATE assets SET source_revision = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(nextSourceRevision, JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: scene.description, episodeNumbers: scene.episodeNumbers }), now, assetId, projectId),
      );
    }
    const continuity = JSON.stringify({ description: scene.description, continuity: scene.visualContinuity, styleLocked: false, lightingLocked: false });
    const existingScene = existingSceneByName.get(scene.name);
    if (existingScene) {
      statements.push(
        getD1().prepare("UPDATE story_scenes SET asset_id = ?, episode_scope_json = ?, time_of_day = ?, interior_exterior = ?, visual_continuity_json = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(assetId, JSON.stringify(scene.episodeNumbers), scene.timeOfDay || null, scene.interiorExterior, continuity, "draft", now, existingScene.id, projectId),
      );
    } else {
      statements.push(
        getD1().prepare("INSERT INTO story_scenes (id, project_id, asset_id, name, episode_scope_json, time_of_day, interior_exterior, visual_continuity_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), projectId, assetId, scene.name, JSON.stringify(scene.episodeNumbers), scene.timeOfDay || null, scene.interiorExterior, continuity, "draft", now, now),
      );
    }
  }

  for (const prop of analysis.props) {
    const existingProp = existingAssetByKey.get(`prop:${prop.name}`);
    if (existingProp) {
      statements.push(
        getD1().prepare("UPDATE assets SET source_revision = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(nextSourceRevision, JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: prop.description, episodeNumbers: prop.episodeNumbers }), now, existingProp.id, projectId),
      );
    } else {
      statements.push(
        getD1().prepare("INSERT INTO assets (id, project_id, episode_id, asset_type, source_revision, name, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), projectId, null, "prop", nextSourceRevision, prop.name, "extracted", JSON.stringify({ source: "llm_analysis", sourceRevision: nextSourceRevision, description: prop.description, episodeNumbers: prop.episodeNumbers }), now, now),
      );
      createdProps += 1;
    }
  }

  for (const episodeAnalysis of analysis.episodes) {
    const episode = projectEpisodes.find((item) => item.episodeNumber === episodeAnalysis.episodeNumber);
    if (episode) {
      statements.push(
        getD1().prepare("UPDATE episodes SET title = ?, summary = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(episodeAnalysis.title, episodeAnalysis.summary, "confirmed", now, episode.id, projectId),
      );
      continue;
    }
    throw new Error(`LLM_ANALYSIS_EPISODE_MISMATCH:${episodeAnalysis.episodeNumber}`);
  }

  const existingWorld = (() => {
    try {
      const parsed = JSON.parse(existingBible[0]?.worldJson || "{}") as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  })();
  const worldJson = JSON.stringify({
    ...existingWorld,
    premise: analysis.world.premise,
    rules: analysis.world.rules,
    tone: analysis.world.tone,
    characters: analysis.characters,
    scenes: analysis.scenes,
    props: analysis.props,
  });
  const timelineJson = JSON.stringify(analysis.episodes);
  const relationshipsJson = JSON.stringify(analysis.relationships);
  if (!existingBible.length) {
    statements.push(
      getD1().prepare("INSERT INTO story_bibles (id, project_id, source_revision, logline, world_json, timeline_json, relationships_json, style_guide_json, narration_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), projectId, nextSourceRevision, analysis.logline, worldJson, timelineJson, relationshipsJson, JSON.stringify({ stylePreset: project.stylePreset, aspectRatio: project.aspectRatio }), analysis.narrationMode, "reviewing", now, now),
    );
  } else {
    statements.push(
      getD1().prepare("UPDATE story_bibles SET source_revision = ?, logline = ?, world_json = ?, timeline_json = ?, relationships_json = ?, narration_mode = ?, status = ?, updated_at = ? WHERE project_id = ?")
        .bind(nextSourceRevision, analysis.logline, worldJson, timelineJson, relationshipsJson, analysis.narrationMode, "reviewing", now, projectId),
    );
  }

  statements.push(
    getD1().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind("assets", now, projectId, user.id),
  );
  await getD1().batch(statements);
  const result = {
    extracted: {
      characters: analysis.characters.map((character) => character.name),
      scenes: analysis.scenes.map((scene) => scene.name),
      props: analysis.props.map((prop) => prop.name),
    },
    analysis: { logline: analysis.logline, narrationMode: analysis.narrationMode, episodes: analysis.episodes.length },
    created: { characters: createdCharacters, scenes: createdScenes, props: createdProps },
  };
  const completedAt = new Date();
  await db.update(generationJobs).set({ status: "succeeded", resultJson: JSON.stringify(result), finishedAt: completedAt, updatedAt: completedAt }).where(eq(generationJobs.id, textJobId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "LLM_ANALYSIS_FAILED";
      const failedAt = new Date();
      await db.update(generationJobs).set({ status: "failed", errorCode: "LLM_ANALYSIS_FAILED", errorMessage: reason, finishedAt: failedAt, updatedAt: failedAt }).where(eq(generationJobs.id, textJobId));
      await db.update(projects).set({ status: "script_analysis_failed", updatedAt: failedAt }).where(eq(projects.id, projectId));
    }
  })());
  return json({ job: { id: textJobId, status: "running", capability: "llm_analysis", projectId } }, { status: 202 });
}
