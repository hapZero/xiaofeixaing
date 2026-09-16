import { getD1 } from "../../../db";
import { formatOutlineForPrompt, formatOutlineForEpisodeGeneration, isStoryOutlineReady, parseDramaOutlineFromStoryBible } from "../drama-outline";
import { generateDramaEpisodes, generateDramaOutline, type GeneratedDramaOutline, type LlmConnection } from "./llm";

export type DramaScriptGenerationInput = {
  ownerId: string;
  jobId: string;
  project: {
    id: string;
    title: string;
    synopsis: string | null;
    stylePreset: string;
    aspectRatio: string;
  };
  episodeCount: number;
  connection: LlmConnection;
  existingStoryBible?: {
    logline: string | null;
    worldJson: string;
    relationshipsJson: string;
  } | null;
  phase?: "outline_only" | "episodes_only" | "full";
};

function buildWorldJson(outline: GeneratedDramaOutline) {
  return JSON.stringify({
    premise: outline.world.premise,
    rules: outline.world.rules,
    tone: outline.world.tone,
    genre: outline.genre,
    coreHooks: outline.coreHooks,
    targetAudience: outline.targetAudience,
    outlineCharacters: outline.characters,
  });
}

function saveStoryBibleStatements(projectId: string, outline: GeneratedDramaOutline, project: DramaScriptGenerationInput["project"], finished: number) {
  return getD1().prepare(
    "INSERT INTO story_bibles (id, project_id, source_revision, logline, world_json, timeline_json, relationships_json, style_guide_json, narration_mode, status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, '[]', ?, ?, 'dialogue', 'outline_ready', ?, ?) ON CONFLICT(project_id) DO UPDATE SET source_revision = story_bibles.source_revision + 1, logline = excluded.logline, world_json = excluded.world_json, relationships_json = excluded.relationships_json, style_guide_json = excluded.style_guide_json, status = 'outline_ready', updated_at = excluded.updated_at",
  ).bind(
    crypto.randomUUID(),
    projectId,
    outline.logline,
    buildWorldJson(outline),
    JSON.stringify(outline.relationships),
    JSON.stringify({ stylePreset: project.stylePreset, aspectRatio: project.aspectRatio }),
    finished,
    finished,
  );
}

export async function executeDramaScriptGeneration(input: DramaScriptGenerationInput) {
  const { ownerId, jobId, project, episodeCount, connection, existingStoryBible, phase = "full" } = input;
  try {
    if (!project.synopsis?.trim()) throw new Error("LLM_SCRIPT_IDEA_MISSING");
    let outline: GeneratedDramaOutline;
    if (phase === "episodes_only" && existingStoryBible && isStoryOutlineReady(existingStoryBible)) {
      const parsed = parseDramaOutlineFromStoryBible(existingStoryBible);
      outline = {
        title: project.title,
        logline: parsed.logline,
        genre: parsed.genre,
        coreHooks: parsed.coreHooks,
        targetAudience: parsed.targetAudience,
        world: { premise: parsed.premise, rules: [], tone: parsed.tone },
        relationships: parsed.relationships,
        characters: parsed.characters,
      };
    } else {
      outline = await generateDramaOutline(connection, {
        idea: project.synopsis,
        episodeCount,
        stylePreset: project.stylePreset,
        aspectRatio: project.aspectRatio,
      });
      const outlineFinished = Math.floor(Date.now() / 1_000);
      const generatedTitle = ["新的 AI 短剧", "未命名短剧"].includes(project.title) ? outline.title : project.title;
      await getD1().batch([
        getD1().prepare("UPDATE projects SET title = ?, status = 'scripting', updated_at = ? WHERE id = ? AND owner_id = ?")
          .bind(generatedTitle, outlineFinished, project.id, ownerId),
        saveStoryBibleStatements(project.id, outline, project, outlineFinished),
        getD1().prepare("UPDATE generation_jobs SET status = 'succeeded', result_json = ?, error_code = NULL, error_message = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
          .bind(JSON.stringify({ stage: "outline", title: generatedTitle, episodeCount }), outlineFinished, outlineFinished, jobId, ownerId),
      ]);
      if (phase === "outline_only") return;
    }

    const episodesStarted = Math.floor(Date.now() / 1_000);
    await getD1().prepare("UPDATE generation_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(JSON.stringify({ stage: "episodes", episodeCount }), episodesStarted, jobId, ownerId)
      .run();

    const episodes = await generateDramaEpisodes(connection, {
      idea: project.synopsis,
      episodeCount,
      stylePreset: project.stylePreset,
      aspectRatio: project.aspectRatio,
      outline,
    });
    const finished = Math.floor(Date.now() / 1_000);
    const generatedTitle = ["新的 AI 短剧", "未命名短剧"].includes(project.title) ? outline.title : project.title;
    const statements: D1PreparedStatement[] = [
      getD1().prepare("UPDATE projects SET title = ?, status = 'scripting', updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(generatedTitle, finished, project.id, ownerId),
      getD1().prepare("DELETE FROM episodes WHERE project_id = ? AND episode_number > ?")
        .bind(project.id, episodes.length),
      saveStoryBibleStatements(project.id, outline, project, finished),
    ];
    episodes.forEach((episode, index) => statements.push(
      getD1().prepare(
        "INSERT INTO episodes (id, project_id, episode_number, title, summary, script_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?) ON CONFLICT(project_id, episode_number) DO UPDATE SET title = excluded.title, summary = excluded.summary, script_text = excluded.script_text, status = 'generated', updated_at = excluded.updated_at",
      ).bind(crypto.randomUUID(), project.id, index + 1, episode.title, episode.summary, episode.scriptText, finished, finished),
    ));
    statements.push(
      getD1().prepare("UPDATE story_bibles SET timeline_json = ?, status = 'generated', updated_at = ? WHERE project_id = ?")
        .bind(JSON.stringify(episodes.map((episode, index) => ({ episode: index + 1, title: episode.title, summary: episode.summary }))), finished, project.id),
      getD1().prepare("UPDATE generation_jobs SET status = 'succeeded', result_json = ?, error_code = NULL, error_message = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(JSON.stringify({ stage: "complete", title: generatedTitle, episodeCount: episodes.length }), finished, finished, jobId, ownerId),
    );
    await getD1().batch(statements);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "LLM_SCRIPT_FAILED";
    const failed = Math.floor(Date.now() / 1_000);
    await getD1().batch([
      getD1().prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'LLM_SCRIPT_FAILED', error_message = ?, finished_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(reason, failed, failed, jobId, ownerId),
      getD1().prepare("UPDATE projects SET status = 'script_generation_failed', updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(failed, project.id, ownerId),
    ]);
  }
}

export function outlinePromptFromStoryBible(storyBible: { logline: string | null; worldJson: string; relationshipsJson: string } | null | undefined) {
  return formatOutlineForPrompt(parseDramaOutlineFromStoryBible(storyBible));
}

export function episodeOutlinePromptFromStoryBible(storyBible: { logline: string | null; worldJson: string; relationshipsJson: string } | null | undefined) {
  return formatOutlineForEpisodeGeneration(parseDramaOutlineFromStoryBible(storyBible));
}
