import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { audioTracks, dialogueLines, episodes, projects, segments, shots } from "../../../db/schema";

async function invalidateSegmentSound(projectId: string, segmentIds: string[], updatedAt: Date) {
  const uniqueSegmentIds = [...new Set(segmentIds)];
  if (!uniqueSegmentIds.length) return;
  const db = getDb();
  const affected = await db.select().from(segments).where(inArray(segments.id, uniqueSegmentIds));
  for (const segment of affected) {
    await db.update(segments).set({
      audioAssetId: null,
      status: segment.videoAssetId ? "video_ready" : segment.status,
      updatedAt,
    }).where(eq(segments.id, segment.id));
  }
  const episodeIds = [...new Set(affected.map((segment) => segment.episodeId))];
  if (episodeIds.length) {
    await db.update(episodes).set({ videoAssetId: null, subtitleAssetId: null, status: "production", updatedAt }).where(inArray(episodes.id, episodeIds));
  }
  await db.update(projects).set({ status: "production", updatedAt }).where(eq(projects.id, projectId));
}

export async function invalidateEnvironmentPresetSound(projectId: string, presetId: string, updatedAt: Date) {
  const db = getDb();
  const tracks = await db.select().from(audioTracks).where(eq(audioTracks.presetId, presetId));
  if (tracks.length) {
    await db.update(audioTracks).set({ assetId: null, status: "planned", updatedAt }).where(eq(audioTracks.presetId, presetId));
    await invalidateSegmentSound(projectId, tracks.flatMap((track) => track.segmentId ? [track.segmentId] : []), updatedAt);
  }
}

export async function invalidateCharacterVoice(options: { projectId: string; characterId: string; voiceReferenceAssetId: string | null; updatedAt: Date }) {
  const db = getDb();
  const lines = await db.select().from(dialogueLines).where(eq(dialogueLines.speakerCharacterId, options.characterId));
  if (!lines.length) return;
  const lineIds = new Set(lines.map((line) => line.id));
  const shotIds = [...new Set(lines.map((line) => line.shotId))];
  await db.update(dialogueLines).set({ audioAssetId: null, voiceReferenceAssetId: options.voiceReferenceAssetId, updatedAt: options.updatedAt }).where(inArray(dialogueLines.id, [...lineIds]));
  const candidateTracks = await db.select().from(audioTracks).where(and(eq(audioTracks.trackType, "dialogue"), inArray(audioTracks.shotId, shotIds)));
  const staleTracks = candidateTracks.filter((track) => {
    try {
      const lineId = (JSON.parse(track.configJson) as { dialogueLineId?: unknown }).dialogueLineId;
      return typeof lineId === "string" && lineIds.has(lineId);
    } catch {
      return false;
    }
  });
  if (staleTracks.length) await db.delete(audioTracks).where(inArray(audioTracks.id, staleTracks.map((track) => track.id)));
  const affectedShots = await db.select().from(shots).where(inArray(shots.id, shotIds));
  await invalidateSegmentSound(options.projectId, affectedShots.flatMap((shot) => shot.segmentId ? [shot.segmentId] : []), options.updatedAt);
}
