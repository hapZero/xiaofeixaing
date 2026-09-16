export function segmentVersionHasFinishedAudio(productionMode: string, inputsJson: string): boolean {
  if (productionMode === "visual_plus_audio_mux") return true;
  try {
    const parsed = JSON.parse(inputsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const inputs = parsed as Record<string, unknown>;
    return inputs.soundMode === "native" || typeof inputs.audioAssetId === "string";
  } catch {
    return false;
  }
}

/**
 * AI continuity review is optional. A segment can enter an episode render
 * after either a successful AI review or an explicit creator approval.
 */
export function segmentVersionApprovedForEpisodeRender(qualityJson: string, status?: string | null): boolean {
  if (status === "approved") return true;
  try {
    const parsed = JSON.parse(qualityJson || "{}") as {
      overall?: { status?: string };
      review?: { decision?: string };
    };
    return parsed.overall?.status === "passed"
      || parsed.overall?.status === "manually_approved"
      || parsed.review?.decision === "approved";
  } catch {
    return false;
  }
}
