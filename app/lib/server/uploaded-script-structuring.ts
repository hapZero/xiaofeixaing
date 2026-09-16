import { getD1 } from "../../../db";
import { structureUploadedDrama, type LlmConnection } from "./llm";

export type UploadedScriptStructuringInput = {
  ownerId: string;
  jobId: string;
  project: {
    id: string;
    title: string;
    sourceText: string | null;
    stylePreset: string;
    aspectRatio: string;
  };
  connection: LlmConnection;
};

export async function executeUploadedScriptStructuring(input: UploadedScriptStructuringInput) {
  const { ownerId, jobId, project, connection } = input;
  try {
    if (!project.sourceText?.trim()) throw new Error("LLM_STRUCTURE_SOURCE_MISSING");
    const structured = await structureUploadedDrama(connection, {
      scriptText: project.sourceText,
      stylePreset: project.stylePreset,
      aspectRatio: project.aspectRatio,
    });
    const finished = Math.floor(Date.now() / 1_000);
    const structuredTitle = ["未命名短剧", "新的短剧"].includes(project.title) ? structured.title : project.title;
    const statements: D1PreparedStatement[] = [
      getD1().prepare("UPDATE projects SET title = ?, status = 'scripting', updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(structuredTitle, finished, project.id, ownerId),
      getD1().prepare("DELETE FROM episodes WHERE project_id = ? AND episode_number > ?")
        .bind(project.id, structured.episodes.length),
    ];
    structured.episodes.forEach((episode) => statements.push(
      getD1().prepare(
        "INSERT INTO episodes (id, project_id, episode_number, title, summary, script_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'structured', ?, ?) ON CONFLICT(project_id, episode_number) DO UPDATE SET title = excluded.title, summary = excluded.summary, script_text = excluded.script_text, status = 'structured', updated_at = excluded.updated_at",
      ).bind(crypto.randomUUID(), project.id, episode.episodeNumber, episode.title, episode.summary, episode.scriptText, finished, finished),
    ));
    statements.push(
      getD1().prepare(
        "INSERT INTO story_bibles (id, project_id, source_revision, logline, world_json, timeline_json, relationships_json, style_guide_json, narration_mode, status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'script_review', ?, ?) ON CONFLICT(project_id) DO UPDATE SET source_revision = story_bibles.source_revision + 1, logline = excluded.logline, world_json = excluded.world_json, timeline_json = excluded.timeline_json, relationships_json = excluded.relationships_json, style_guide_json = excluded.style_guide_json, narration_mode = excluded.narration_mode, status = 'script_review', updated_at = excluded.updated_at",
      ).bind(
        crypto.randomUUID(),
        project.id,
        structured.logline,
        JSON.stringify(structured.world),
        JSON.stringify(structured.episodes.map(({ episodeNumber, title, summary }) => ({ episodeNumber, title, summary }))),
        JSON.stringify(structured.relationships),
        JSON.stringify({ stylePreset: project.stylePreset, aspectRatio: project.aspectRatio }),
        structured.narrationMode,
        finished,
        finished,
      ),
      getD1().prepare("UPDATE generation_jobs SET status = 'succeeded', result_json = ?, error_code = NULL, error_message = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(JSON.stringify({ title: structuredTitle, episodeCount: structured.episodes.length }), finished, finished, jobId, ownerId),
    );
    await getD1().batch(statements);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "LLM_STRUCTURE_FAILED";
    const failed = Math.floor(Date.now() / 1_000);
    await getD1().batch([
      getD1().prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'LLM_STRUCTURE_FAILED', error_message = ?, finished_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(reason, failed, failed, jobId, ownerId),
      getD1().prepare("UPDATE projects SET status = 'script_structure_failed', updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(failed, project.id, ownerId),
    ]);
  }
}
