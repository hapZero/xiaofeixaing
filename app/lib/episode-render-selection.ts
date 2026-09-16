export type RenderSegmentSelection = {
  id: string;
  sequence: number;
  currentVersionNumber: number;
  videoAssetId: string | null;
};

export type RenderShotSelection = {
  id: string;
  segmentId: string | null;
  sequence: number;
};

export type RenderVersionSnapshot = {
  segmentId: string;
  segmentSequence: number;
  versionNumber: number;
  assetId: string;
};

/**
 * Episode renders may contain historical segments from earlier script
 * revisions. Only shots belonging to the current segment set are eligible,
 * and their stable order is segment sequence followed by shot sequence.
 */
export function orderCurrentEpisodeShots<T extends RenderShotSelection>(segments: RenderSegmentSelection[], shots: T[]): T[] {
  const segmentOrder = new Map(segments.map((segment) => [segment.id, segment.sequence]));
  return shots
    .filter((shot) => Boolean(shot.segmentId && segmentOrder.has(shot.segmentId)))
    .sort((left, right) => (
      (segmentOrder.get(left.segmentId as string) ?? Number.MAX_SAFE_INTEGER)
      - (segmentOrder.get(right.segmentId as string) ?? Number.MAX_SAFE_INTEGER)
      || left.sequence - right.sequence
      || left.id.localeCompare(right.id)
    ));
}

export function buildEpisodeRenderSnapshot(segments: RenderSegmentSelection[]): RenderVersionSnapshot[] {
  return [...segments]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .flatMap((segment) => segment.videoAssetId ? [{
      segmentId: segment.id,
      segmentSequence: segment.sequence,
      versionNumber: segment.currentVersionNumber,
      assetId: segment.videoAssetId,
    }] : []);
}

export function episodeRenderSnapshotMatches(current: RenderVersionSnapshot[], submitted: RenderVersionSnapshot[]): boolean {
  if (current.length !== submitted.length) return false;
  return current.every((selection, index) => {
    const expected = submitted[index];
    return selection.segmentId === expected.segmentId
      && selection.segmentSequence === expected.segmentSequence
      && selection.versionNumber === expected.versionNumber
      && selection.assetId === expected.assetId;
  });
}
