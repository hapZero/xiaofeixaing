import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { episodes, projects, segmentAssetReferences, segments, segmentVersions, shotAssetReferences, shots } from "../../../db/schema";
import { deriveProjectRenderStatus } from "../project-delivery";
import { segmentVersionHasFinishedAudio } from "../segment-version";

export type CurrentSegmentVersion = {
  projectId: string;
  episodeId: string;
  segmentId: string;
  assetId: string;
  versionNumber: number;
  status: "video_ready" | "video_audio_ready";
  updatedAt: Date;
};

/**
 * Makes a segment candidate current and invalidates any episode render that was
 * built from the previous segment selection. Historical episode assets and
 * versions remain available; only the current pointer is cleared.
 */
export async function setCurrentSegmentVersion(input: CurrentSegmentVersion) {
  const db = getDb();
  await db.update(segments).set({
    videoAssetId: input.assetId,
    currentVersionNumber: input.versionNumber,
    status: input.status,
    updatedAt: input.updatedAt,
  }).where(eq(segments.id, input.segmentId));
  await db.update(episodes).set({
    videoAssetId: null,
    subtitleAssetId: null,
    status: "production",
    updatedAt: input.updatedAt,
  }).where(eq(episodes.id, input.episodeId));
  await db.update(projects).set({ status: "production", updatedAt: input.updatedAt }).where(eq(projects.id, input.projectId));
}

/**
 * Removes the current segment pointer after a direct shot repair. Historical
 * segment candidates stay intact, while the repaired shot and all untouched
 * shots remain available for the next compose pass.
 */
export async function invalidateSegmentCurrentOutput(projectId: string, segmentId: string, updatedAt: Date) {
  const db = getDb();
  const segment = (await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1))[0] ?? null;
  if (!segment) return null;
  await db.update(segments).set({
    videoAssetId: null,
    audioAssetId: null,
    currentVersionNumber: 0,
    status: "draft",
    updatedAt,
  }).where(eq(segments.id, segmentId));
  await db.update(episodes).set({
    videoAssetId: null,
    subtitleAssetId: null,
    status: "production",
    updatedAt,
  }).where(eq(episodes.id, segment.episodeId));
  await db.update(projects).set({ status: "production", updatedAt }).where(eq(projects.id, projectId));
  return segment;
}

export type VisualDependencySelector = {
  assetIds?: string[];
  characterIds?: string[];
  characterFormIds?: string[];
};

/**
 * Invalidates only current pointers that were produced from a visual asset which
 * has been regenerated or unlocked. Historical media and versions remain
 * available, but stale shot frames/videos cannot silently re-enter a compose.
 */
export async function invalidateVisualDependencyOutputs(projectId: string, selector: VisualDependencySelector, updatedAt: Date) {
  const db = getDb();
  const directShotReferenceRows: Array<typeof shotAssetReferences.$inferSelect> = [];
  const manualSegmentReferenceRows: Array<typeof segmentAssetReferences.$inferSelect> = [];
  const collect = async <T>(values: string[] | undefined, shotColumn: Parameters<typeof inArray>[0], segmentColumn: Parameters<typeof inArray>[0]) => {
    const ids = [...new Set((values ?? []).filter(Boolean))];
    if (!ids.length) return;
    directShotReferenceRows.push(...await db.select().from(shotAssetReferences).where(inArray(shotColumn, ids)) as Array<typeof shotAssetReferences.$inferSelect>);
    manualSegmentReferenceRows.push(...await db.select().from(segmentAssetReferences).where(inArray(segmentColumn, ids)) as Array<typeof segmentAssetReferences.$inferSelect>);
  };
  await collect(selector.assetIds, shotAssetReferences.assetId, segmentAssetReferences.assetId);
  await collect(selector.characterIds, shotAssetReferences.characterId, segmentAssetReferences.characterId);
  await collect(selector.characterFormIds, shotAssetReferences.characterFormId, segmentAssetReferences.characterFormId);

  const directShotIds = [...new Set(directShotReferenceRows.map((reference) => reference.shotId))];
  const directShots = directShotIds.length ? await db.select().from(shots).where(inArray(shots.id, directShotIds)) : [];
  const segmentIds = new Set([
    ...directShots.flatMap((shot) => shot.segmentId ? [shot.segmentId] : []),
    ...manualSegmentReferenceRows.map((reference) => reference.segmentId),
  ]);
  const manualSegmentIds = [...new Set(manualSegmentReferenceRows.map((reference) => reference.segmentId))];
  const manualShots = manualSegmentIds.length ? await db.select().from(shots).where(inArray(shots.segmentId, manualSegmentIds)) : [];
  const affectedShots = [...new Map([...directShots, ...manualShots].map((shot) => [shot.id, shot])).values()];
  const affectedShotIds = affectedShots.map((shot) => shot.id);
  const affectedSegmentIds = [...segmentIds];
  const affectedSegments = affectedSegmentIds.length ? await db.select().from(segments).where(inArray(segments.id, affectedSegmentIds)) : [];
  const segmentsWithProducedPointers = new Set(affectedSegments.flatMap((segment) => (
    segment.videoAssetId || segment.audioAssetId || segment.currentVersionNumber > 0 ? [segment.id] : []
  )));
  for (const shot of affectedShots) {
    if (shot.segmentId && (shot.firstFrameAssetId || shot.videoAssetId)) segmentsWithProducedPointers.add(shot.segmentId);
  }
  if (affectedShotIds.length) {
    await db.update(shots).set({ firstFrameAssetId: null, videoAssetId: null, status: "draft", updatedAt }).where(inArray(shots.id, affectedShotIds));
  }
  for (const segmentId of segmentIds) {
    if (segmentsWithProducedPointers.has(segmentId)) await invalidateSegmentCurrentOutput(projectId, segmentId, updatedAt);
    else await db.update(segments).set({ status: "draft", updatedAt }).where(eq(segments.id, segmentId));
  }
  return { shotCount: affectedShotIds.length, segmentCount: segmentIds.size };
}

export async function markEpisodeRenderStarted(projectId: string, episodeId: string, updatedAt: Date) {
  const db = getDb();
  await db.update(episodes).set({ status: "rendering", updatedAt }).where(eq(episodes.id, episodeId));
  await db.update(projects).set({ status: "rendering", updatedAt }).where(eq(projects.id, projectId));
}

export async function markSegmentGenerationFailed(segmentId: string, updatedAt: Date) {
  const db = getDb();
  const segment = (await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1))[0] ?? null;
  if (!segment) return null;
  const currentVersion = segment.currentVersionNumber > 0
    ? (await db.select().from(segmentVersions).where(and(eq(segmentVersions.segmentId, segmentId), eq(segmentVersions.versionNumber, segment.currentVersionNumber))).orderBy(desc(segmentVersions.versionNumber)).limit(1))[0] ?? null
    : null;
  const status = segment.videoAssetId
    ? currentVersion && segmentVersionHasFinishedAudio(currentVersion.productionMode, currentVersion.inputsJson) ? "video_audio_ready" : "video_ready"
    : "generation_failed";
  await db.update(segments).set({ status, updatedAt }).where(eq(segments.id, segmentId));
  return status;
}

export async function refreshProjectRenderStatus(projectId: string, updatedAt: Date) {
  const db = getDb();
  const projectEpisodes = await db.select().from(episodes).where(eq(episodes.projectId, projectId));
  const status = deriveProjectRenderStatus(projectEpisodes);
  await db.update(projects).set({ status, updatedAt }).where(eq(projects.id, projectId));
  return status;
}

export async function markEpisodeRenderFailed(projectId: string, episodeId: string, updatedAt: Date) {
  const db = getDb();
  const episode = (await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1))[0] ?? null;
  if (episode) {
    await db.update(episodes).set({
      status: episode.videoAssetId ? "rendered" : "production",
      updatedAt,
    }).where(eq(episodes.id, episodeId));
  }
  return refreshProjectRenderStatus(projectId, updatedAt);
}
