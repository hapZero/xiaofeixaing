import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { assets, characterForms, characters, storyBibles } from "../../../db/schema";
import { updateVisualAssetApproval, visualAssetApproved, visualAssetMediaReady } from "../visual-asset-approval";

export type ProjectVisualAssetScope = {
  currentSourceRevision: number;
  currentAssets: Array<typeof assets.$inferSelect>;
  currentCharacterForms: Array<typeof characterForms.$inferSelect>;
};

export async function loadProjectVisualAssetScope(projectId: string): Promise<ProjectVisualAssetScope> {
  const db = getDb();
  const [projectAssets, projectCharacters, projectStoryBible] = await Promise.all([
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1),
  ]);
  const currentSourceRevision = projectStoryBible[0]?.sourceRevision ?? 1;
  const currentAssets = projectAssets.filter((asset) => asset.sourceRevision === null || asset.sourceRevision === currentSourceRevision);
  const currentAssetIds = new Set(currentAssets.map((asset) => asset.id));
  const currentCharacters = projectCharacters.filter((character) => !character.assetId || currentAssetIds.has(character.assetId));
  const currentCharacterForms = currentCharacters.length
    ? await db.select().from(characterForms).where(inArray(characterForms.characterId, currentCharacters.map((character) => character.id)))
    : [];
  return { currentSourceRevision, currentAssets, currentCharacterForms };
}

export function listLockableVisualAssetIds(scope: ProjectVisualAssetScope): string[] {
  const assetById = new Map(scope.currentAssets.map((asset) => [asset.id, asset]));
  const ids = new Set<string>();
  for (const form of scope.currentCharacterForms) {
    const asset = form.assetId ? assetById.get(form.assetId) : null;
    if (visualAssetMediaReady(asset) && !visualAssetApproved(asset?.metadataJson)) ids.add(form.assetId!);
  }
  for (const asset of scope.currentAssets) {
    if (!["scene", "prop"].includes(asset.assetType)) continue;
    if (visualAssetMediaReady(asset) && !visualAssetApproved(asset.metadataJson)) ids.add(asset.id);
  }
  return [...ids];
}

export function listMissingVisualAssetLabels(scope: ProjectVisualAssetScope): string[] {
  const assetById = new Map(scope.currentAssets.map((asset) => [asset.id, asset]));
  return [
    ...scope.currentCharacterForms.flatMap((form) => {
      const asset = form.assetId ? assetById.get(form.assetId) : null;
      return visualAssetMediaReady(asset) ? [] : [`角色形态「${form.name}」`];
    }),
    ...scope.currentAssets.filter((asset) => ["scene", "prop"].includes(asset.assetType)).flatMap((asset) => (
      visualAssetMediaReady(asset) ? [] : [`${asset.assetType === "scene" ? "场景" : "道具"}「${asset.name}」`]
    )),
  ];
}

export async function lockReadyProjectVisualAssets(projectId: string) {
  const db = getDb();
  const scope = await loadProjectVisualAssetScope(projectId);
  const assetIds = listLockableVisualAssetIds(scope);
  const updatedAt = new Date();
  for (const assetId of assetIds) {
    const asset = scope.currentAssets.find((item) => item.id === assetId);
    if (!asset) continue;
    await db.update(assets).set({
      metadataJson: updateVisualAssetApproval(asset.metadataJson, true, updatedAt.toISOString()),
      updatedAt,
    }).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)));
  }
  return { locked: assetIds.length, assetIds, pending: listMissingVisualAssetLabels(scope) };
}
