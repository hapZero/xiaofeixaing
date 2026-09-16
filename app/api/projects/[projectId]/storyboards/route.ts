import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  assets,
  audioPresets,
  characters,
  episodes,
  segments,
  shots,
  storyBibles,
  storyScenes,
} from "../../../../../db/schema";
import type { StructuredDramaAnalysis } from "../../../../lib/server/llm";
import { selectCharacterFormForShot } from "../../../../lib/character-form-selection";
import { errorResponse, json, readJson } from "../../../../lib/server/http";
import { getOwnedProject } from "../../../../lib/server/project-access";
import { getRequestUser } from "../../../../lib/server/request-user";
import { effectiveVerifiedCapabilities, getWorkflowBindingReadiness } from "../../../../lib/server/verified-workflows";
import { loadProductionRoutingRules } from "../../../../lib/server/production-routing-store";
import { parseShotProductionIntent, resolveShotProductionPlan } from "../../../../lib/production-planner";
import { listMissingVisualAssetLabels, loadProjectVisualAssetScope, lockReadyProjectVisualAssets } from "../../../../lib/server/visual-asset-approval-batch";

type RouteContext = { params: Promise<{ projectId: string }> };

function presetSceneAssetId(configJson: string): string | null {
  try {
    const config = JSON.parse(configJson) as { sceneAssetId?: unknown };
    return typeof config.sceneAssetId === "string" ? config.sceneAssetId : null;
  } catch {
    return null;
  }
}

function structuredEpisodes(timelineJson: string | null | undefined): StructuredDramaAnalysis["episodes"] {
  if (!timelineJson) return [];
  try {
    const parsed = JSON.parse(timelineJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((episode): episode is StructuredDramaAnalysis["episodes"][number] => {
      if (!episode || typeof episode !== "object") return false;
      const value = episode as { episodeNumber?: unknown; segments?: unknown };
      return typeof value.episodeNumber === "number" && Array.isArray(value.segments) && value.segments.some((segment) => segment && typeof segment === "object" && Array.isArray((segment as { shots?: unknown }).shots));
    });
  } catch {
    return [];
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    return await postStoryboards(request, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "分镜脚本生成失败";
    console.error("[storyboards] POST failed", error);
    return errorResponse(500, "STORYBOARD_CREATE_FAILED", message);
  }
}

async function postStoryboards(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await context.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const body = await readJson<{ force?: boolean }>(request);

  const db = getDb();
  const [projectEpisodes, projectAssets, projectCharacters, presets, projectStoryScenes, projectStoryBible] = await Promise.all([
    db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(audioPresets).where(eq(audioPresets.projectId, projectId)),
    db.select().from(storyScenes).where(eq(storyScenes.projectId, projectId)),
    db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1),
  ]);
  if (!projectEpisodes.length) return errorResponse(409, "EPISODES_REQUIRED", "项目还没有分集剧本");
  await lockReadyProjectVisualAssets(projectId);
  const scope = await loadProjectVisualAssetScope(projectId);
  const currentSourceRevision = scope.currentSourceRevision;
  const currentAssets = scope.currentAssets;
  const currentAssetIds = new Set(currentAssets.map((asset) => asset.id));
  const currentCharacters = projectCharacters.filter((character) => !character.assetId || currentAssetIds.has(character.assetId));
  const currentStoryScenes = projectStoryScenes.filter((scene) => !scene.assetId || currentAssetIds.has(scene.assetId));
  const currentCharacterForms = scope.currentCharacterForms;
  const missingVisuals = listMissingVisualAssetLabels(scope);
  if (missingVisuals.length) return errorResponse(409, "VISUAL_ASSETS_NOT_READY", `还有 ${missingVisuals.length} 项视觉资产尚未生成：${missingVisuals.slice(0, 3).join("、")}${missingVisuals.length > 3 ? "等" : ""}`);
  const analyzedEpisodes = structuredEpisodes(projectStoryBible[0]?.timelineJson);
  if (!analyzedEpisodes.length) return errorResponse(409, "SCRIPT_ANALYSIS_REQUIRED", "请先确认剧本，让文本智能服务生成片段与分镜草案");

  const existingShots = await db.select().from(shots).where(and(inArray(shots.episodeId, projectEpisodes.map((episode) => episode.id)), eq(shots.sourceRevision, currentSourceRevision)));
  const existingSegments = await db.select().from(segments).where(and(inArray(segments.episodeId, projectEpisodes.map((episode) => episode.id)), eq(segments.sourceRevision, currentSourceRevision)));
  if (existingShots.length && !body?.force) {
    if (!existingSegments.length || existingShots.some((shot) => !shot.segmentId)) {
      const now = Math.floor(Date.now() / 1_000);
      const statements: D1PreparedStatement[] = [];
      const segmentCountByEpisode = new Map<string, number>();
      for (const shot of [...existingShots].sort((a, b) => a.sequence - b.sequence)) {
        if (shot.segmentId) continue;
        const sequence = (segmentCountByEpisode.get(shot.episodeId) ?? 0) + 1;
        segmentCountByEpisode.set(shot.episodeId, sequence);
        const segmentId = crypto.randomUUID();
        statements.push(
          getD1().prepare("INSERT INTO segments (id, episode_id, sequence, source_revision, title, synopsis, duration_ms, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(segmentId, shot.episodeId, sequence, currentSourceRevision, shot.title, shot.prompt.slice(0, 220), shot.durationMs, "ready", now, now),
          getD1().prepare("UPDATE shots SET segment_id = ?, updated_at = ? WHERE id = ?")
            .bind(segmentId, now, shot.id),
        );
      }
      if (statements.length) await getD1().batch(statements);
    }
    return json({ created: 0, segments: Math.max(existingSegments.length, existingShots.length), shots: existingShots.length, reused: true });
  }
  if (existingShots.length && body?.force) {
    const produced = existingSegments.some((segment) => segment.videoAssetId || segment.audioAssetId || segment.currentVersionNumber > 0)
      || existingShots.some((shot) => shot.firstFrameAssetId || shot.videoAssetId || !["draft", "edited", "ready"].includes(shot.status));
    if (produced) return errorResponse(409, "STORYBOARD_REGENERATION_BLOCKED", "已有分镜包含生成结果或片段版本。为保护历史媒体，请在编辑器中逐片段重做，而不是覆盖整套分镜");
    await db.delete(shots).where(inArray(shots.id, existingShots.map((shot) => shot.id)));
    if (existingSegments.length) await db.delete(segments).where(inArray(segments.id, existingSegments.map((segment) => segment.id)));
  }

  const sceneAssets = currentAssets.filter((asset) => asset.assetType === "scene");
  const presetBySceneName = new Map<string, string>();
  for (const preset of presets) {
    const sceneId = presetSceneAssetId(preset.configJson);
    const scene = sceneAssets.find((asset) => asset.id === sceneId);
    if (scene) presetBySceneName.set(scene.name, preset.id);
  }
  const storySceneByName = new Map(currentStoryScenes.map((scene) => [scene.name, scene]));

  const now = Math.floor(Date.now() / 1_000);
  const readiness = await getWorkflowBindingReadiness(user.id);
  const configured = effectiveVerifiedCapabilities(readiness.verifiedBindings);
  const routingRules = await loadProductionRoutingRules(user.id);
  const statements: D1PreparedStatement[] = [];
  let createdSegments = 0;
  let createdShots = 0;
  let createdDialogueLines = 0;
  for (const episode of projectEpisodes) {
    const analyzedEpisode = analyzedEpisodes.find((item) => item.episodeNumber === episode.episodeNumber);
    const segmentDrafts = analyzedEpisode?.segments ?? [];
    let shotSequence = 0;
    segmentDrafts.forEach((segmentDraft, segmentIndex) => {
      const segmentId = crypto.randomUUID();
      const segmentDuration = segmentDraft.shots.reduce((sum, shot) => sum + Math.round(shot.durationSeconds * 1_000), 0);
      const storyScene = segmentDraft.sceneName ? storySceneByName.get(segmentDraft.sceneName) ?? null : null;
      const environmentPresetId = segmentDraft.sceneName ? presetBySceneName.get(segmentDraft.sceneName) ?? null : null;
      statements.push(
        getD1().prepare("INSERT INTO segments (id, episode_id, story_scene_id, sequence, source_revision, title, synopsis, duration_ms, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(segmentId, episode.id, storyScene?.id ?? null, segmentIndex + 1, currentSourceRevision, segmentDraft.title, segmentDraft.synopsis, segmentDuration, "ready", now, now),
      );
      if (environmentPresetId) {
        statements.push(
          getD1().prepare("INSERT INTO audio_tracks (id, episode_id, segment_id, shot_id, track_type, preset_id, start_ms, duration_ms, gain_centi_db, config_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), episode.id, segmentId, null, "ambience", environmentPresetId, 0, segmentDuration, -600, JSON.stringify({ continuousAcrossScene: true, loopToFill: true }), "planned", now, now),
        );
      }
      createdSegments += 1;

      segmentDraft.shots.forEach((shotDraft) => {
        shotSequence += 1;
        const shotId = crypto.randomUUID();
        const referencedCharacters = currentCharacters.filter((character) => shotDraft.prompt.includes(character.canonicalName) || shotDraft.dialogue.some((line) => line.speaker === character.canonicalName));
        const referencedProps = currentAssets.filter((asset) => asset.assetType === "prop" && shotDraft.prompt.includes(asset.name));
        const intent = {
          characterCount: referencedCharacters.length,
          hasDialogue: shotDraft.dialogue.some((line) => line.lineType === "dialogue"),
          hasVoiceReference: referencedCharacters.some((character) => Boolean(character.voiceAssetId)),
          hasFirstFrame: false,
          hasLastFrame: false,
        };
        const resolvedPlan = resolveShotProductionPlan(intent, configured, routingRules);
        const generationPlan = {
          intent,
          videoCapability: resolvedPlan.videoCapability,
          automaticallyResolved: true,
        };
        statements.push(
          getD1().prepare("INSERT INTO shots (id, episode_id, segment_id, sequence, source_revision, title, prompt, duration_ms, shot_type, camera_json, sound_plan_json, generation_plan_json, status, environment_preset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(
              shotId,
              episode.id,
              segmentId,
              shotSequence,
              currentSourceRevision,
              shotDraft.title,
              shotDraft.prompt,
              Math.round(shotDraft.durationSeconds * 1_000),
              shotDraft.shotType,
              JSON.stringify({ source: "llm_director_prompt" }),
              JSON.stringify({ dialogue: shotDraft.dialogue, sceneName: segmentDraft.sceneName }),
              JSON.stringify(generationPlan),
              "draft",
              environmentPresetId,
              now,
              now,
            ),
        );

        let referenceOrder = 0;
        if (storyScene?.assetId) {
          statements.push(
            getD1().prepare("INSERT INTO shot_asset_references (id, shot_id, asset_id, reference_role, reference_order, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(crypto.randomUUID(), shotId, storyScene.assetId, "scene", referenceOrder++, true, now, now),
          );
        }
        for (const character of referencedCharacters) {
          const selectedForm = selectCharacterFormForShot(
            currentCharacterForms.filter((form) => form.characterId === character.id),
            episode.episodeNumber,
            `${shotDraft.prompt}\n${shotDraft.dialogue.map((line) => line.text).join("\n")}`,
          );
          statements.push(
            getD1().prepare("INSERT INTO shot_asset_references (id, shot_id, asset_id, character_id, character_form_id, reference_role, reference_order, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(crypto.randomUUID(), shotId, selectedForm?.assetId ?? character.assetId, character.id, selectedForm?.id ?? null, "character", referenceOrder++, true, now, now),
          );
        }
        for (const prop of referencedProps) {
          statements.push(
            getD1().prepare("INSERT INTO shot_asset_references (id, shot_id, asset_id, reference_role, reference_order, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(crypto.randomUUID(), shotId, prop.id, "prop", referenceOrder++, true, now, now),
          );
        }
        shotDraft.dialogue.forEach((line, lineIndex) => {
          const speaker = line.speaker ? currentCharacters.find((character) => character.canonicalName === line.speaker) ?? null : null;
          statements.push(
            getD1().prepare("INSERT INTO dialogue_lines (id, shot_id, sequence, speaker_character_id, line_type, text, emotion, delivery_json, voice_reference_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(crypto.randomUUID(), shotId, lineIndex + 1, speaker?.id ?? null, line.lineType, line.text, line.emotion, JSON.stringify({ mouthOpen: line.mouthOpen }), speaker?.voiceAssetId ?? null, now, now),
          );
          createdDialogueLines += 1;
        });
        createdShots += 1;
      });
    });
  }
  if (!createdShots) return errorResponse(409, "SCRIPT_REQUIRED", "分集剧本没有可拆分的内容");
  statements.push(getD1().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind("storyboarding", now, projectId, user.id));
  await getD1().batch(statements);
  return json({ created: createdShots, segments: createdSegments, shots: createdShots, dialogueLines: createdDialogueLines, reused: false });
}
