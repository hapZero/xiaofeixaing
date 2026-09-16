import type { ProjectProductionDetail, ProjectShot } from "../studio/types";
import { characterNameMentionedInText } from "../../lib/character-mention";
import { visualAssetApproved } from "../../lib/visual-asset-approval";

export type SegmentReferenceView = {
  key: string;
  name: string;
  role: string;
  imageUrl: string | null;
  missing: boolean;
  shotSequences: number[];
};

function addCharacterOptionKeys(keys: Set<string>, detail: ProjectProductionDetail, characterId: string) {
  keys.add(`character:${characterId}`);
  for (const form of detail.characterForms) {
    if (form.characterId === characterId) keys.add(`character_form:${form.id}`);
  }
}

/** Keys of assets referenced by any shot in the episode, or mentioned in that episode's shot prompts. */
export function episodeReferenceKeys(detail: ProjectProductionDetail, episodeId: string): Set<string> {
  const episodeShots = detail.shots.filter((shot) => shot.episodeId === episodeId);
  const shotIds = new Set(episodeShots.map((shot) => shot.id));
  const keys = new Set<string>();
  for (const reference of detail.shotAssetReferences) {
    if (!shotIds.has(reference.shotId)) continue;
    if (reference.characterFormId) keys.add(`character_form:${reference.characterFormId}`);
    else if (reference.characterId) keys.add(`character:${reference.characterId}`);
    else if (reference.assetId && reference.referenceRole === "scene") keys.add(`scene:${reference.assetId}`);
    else if (reference.assetId && reference.referenceRole === "prop") keys.add(`prop:${reference.assetId}`);
  }

  const haystack = episodeShots.map((shot) => `${shot.title}\n${shot.prompt}`).join("\n");
  for (const character of detail.characters) {
    if (characterNameMentionedInText(character.canonicalName, haystack)) {
      addCharacterOptionKeys(keys, detail, character.id);
    }
  }
  for (const asset of detail.assets) {
    if ((asset.assetType === "scene" || asset.assetType === "prop") && asset.name && haystack.includes(asset.name)) {
      keys.add(`${asset.assetType}:${asset.id}`);
    }
  }
  return keys;
}

const roleOrder: Record<string, number> = { character: 0, scene: 1, prop: 2, style: 3 };

export function buildSegmentReferences(detail: ProjectProductionDetail, segmentShots: ProjectShot[]): SegmentReferenceView[] {
  const shotById = new Map(segmentShots.map((shot) => [shot.id, shot]));
  const references = detail.shotAssetReferences.filter((reference) => shotById.has(reference.shotId));
  const grouped = new Map<string, SegmentReferenceView>();

  for (const reference of references) {
    const character = reference.characterId ? detail.characters.find((item) => item.id === reference.characterId) : null;
    const form = reference.characterFormId ? detail.characterForms.find((item) => item.id === reference.characterFormId) : null;
    const assetId = reference.assetId ?? form?.assetId ?? character?.assetId ?? null;
    const asset = assetId ? detail.assets.find((item) => item.id === assetId) : null;
    const identity = reference.characterFormId ?? reference.characterId ?? reference.assetId ?? reference.id;
    const key = `${reference.referenceRole}:${identity}`;
    const shotSequence = shotById.get(reference.shotId)?.sequence;
    const existing = grouped.get(key);
    if (existing) {
      if (typeof shotSequence === "number" && !existing.shotSequences.includes(shotSequence)) existing.shotSequences.push(shotSequence);
      continue;
    }
    grouped.set(key, {
      key,
      name: character ? `${character.canonicalName}${form ? ` · ${form.name}` : ""}` : asset?.name ?? `${reference.referenceRole}（待补齐）`,
      role: reference.referenceRole,
      imageUrl: asset?.thumbnailUrl ?? null,
      missing: reference.required && (!asset?.storageKey || asset.status !== "ready" || !visualAssetApproved(asset.metadataJson)),
      shotSequences: typeof shotSequence === "number" ? [shotSequence] : [],
    });
  }

  return [...grouped.values()]
    .map((reference) => ({ ...reference, shotSequences: reference.shotSequences.sort((a, b) => a - b) }))
    .sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.name.localeCompare(b.name, "zh-CN"));
}

export function segmentReferenceCountByShot(detail: ProjectProductionDetail, segmentShots: ProjectShot[]): Map<string, number> {
  const counts = new Map<string, number>();
  const shotIds = new Set(segmentShots.map((shot) => shot.id));
  for (const reference of detail.shotAssetReferences) {
    if (shotIds.has(reference.shotId)) counts.set(reference.shotId, (counts.get(reference.shotId) ?? 0) + 1);
  }
  return counts;
}

/** Option keys that will actually be sent when generating this shot's first frame. */
export function shotGenerationReferenceKeys(detail: ProjectProductionDetail, shot: ProjectShot): Set<string> {
  const keys = new Set<string>();
  for (const reference of detail.shotAssetReferences) {
    if (reference.shotId !== shot.id) continue;
    if (reference.characterFormId) keys.add(`character_form:${reference.characterFormId}`);
    else if (reference.characterId) keys.add(`character:${reference.characterId}`);
    else if (reference.assetId && reference.referenceRole === "scene") keys.add(`scene:${reference.assetId}`);
    else if (reference.assetId && reference.referenceRole === "prop") keys.add(`prop:${reference.assetId}`);
  }

  const haystack = `${shot.title}\n${shot.prompt}`;
  for (const character of detail.characters) {
    if (!characterNameMentionedInText(character.canonicalName, haystack)) continue;
    addCharacterOptionKeys(keys, detail, character.id);
  }
  for (const asset of detail.assets) {
    if ((asset.assetType === "scene" || asset.assetType === "prop") && asset.name && haystack.includes(asset.name)) {
      keys.add(`${asset.assetType}:${asset.id}`);
    }
  }
  return keys;
}

export function shotGenerationReferenceLabels(detail: ProjectProductionDetail, shot: ProjectShot): string[] {
  const keys = shotGenerationReferenceKeys(detail, shot);
  const labels: string[] = [];
  for (const key of keys) {
    const [kind, id] = key.split(":");
    if (kind === "character_form") {
      const form = detail.characterForms.find((item) => item.id === id);
      const character = form ? detail.characters.find((item) => item.id === form.characterId) : null;
      if (character) labels.push(character.canonicalName);
    } else if (kind === "character") {
      const character = detail.characters.find((item) => item.id === id);
      if (character) labels.push(character.canonicalName);
    } else if (kind === "scene" || kind === "prop") {
      const asset = detail.assets.find((item) => item.id === id);
      if (asset?.name) labels.push(asset.name);
    }
  }
  return [...new Set(labels)];
}

export function formatVersionTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
