export function visualAssetApproved(metadataJson: string | null | undefined): boolean {
  if (!metadataJson) return false;
  try {
    return (JSON.parse(metadataJson) as { visualLocked?: unknown }).visualLocked === true;
  } catch {
    return false;
  }
}

export function visualAssetMediaReady(asset: { status: string; storageKey: string | null } | null | undefined): boolean {
  return Boolean(asset?.status === "ready" && asset.storageKey);
}

export function visualAssetProductionReady(asset: { status: string; storageKey: string | null; metadataJson: string } | null | undefined): boolean {
  return visualAssetMediaReady(asset) && visualAssetApproved(asset?.metadataJson);
}

export function updateVisualAssetApproval(metadataJson: string | null | undefined, locked: boolean, approvedAt = new Date().toISOString()) {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(metadataJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return JSON.stringify({ ...metadata, visualLocked: locked, visualApprovedAt: locked ? approvedAt : null });
}
