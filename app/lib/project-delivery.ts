export function readRenderedSegmentAssetIds(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { segmentAssetIds?: unknown };
    return Array.isArray(parsed.segmentAssetIds) && parsed.segmentAssetIds.every((id) => typeof id === "string")
      ? parsed.segmentAssetIds
      : null;
  } catch {
    return null;
  }
}

export function episodeRenderMatchesCurrentSegments(currentAssetIds: Array<string | null>, renderInputsJson: string | null | undefined) {
  const renderedAssetIds = readRenderedSegmentAssetIds(renderInputsJson);
  return Boolean(renderedAssetIds)
    && currentAssetIds.length > 0
    && currentAssetIds.length === renderedAssetIds!.length
    && currentAssetIds.every((id, index) => Boolean(id) && id === renderedAssetIds![index]);
}

export function deriveProjectRenderStatus(projectEpisodes: Array<{ status: string; videoAssetId: string | null }>) {
  if (projectEpisodes.some((episode) => episode.status === "rendering")) return "rendering" as const;
  if (projectEpisodes.length > 0 && projectEpisodes.every((episode) => episode.status === "rendered" && Boolean(episode.videoAssetId))) return "rendered" as const;
  return "production" as const;
}
