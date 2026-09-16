import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { segmentAssetReferences, shotAssetReferences } from "../../../db/schema";
import { characterNameMentionedInText } from "../character-mention";

export type EffectiveSegmentReference = {
  id: string;
  shotId: string | null;
  segmentId: string | null;
  assetId: string | null;
  characterId: string | null;
  characterFormId: string | null;
  referenceRole: string;
  referenceOrder: number;
  required: boolean;
  source: "segment" | "shot" | "inferred";
};

export type CharacterReferenceCatalogEntry = {
  characterId: string;
  canonicalName: string;
  characterFormId: string | null;
  assetId: string | null;
};

export type ShotReferenceContext = {
  shotTitle?: string;
  shotPrompt?: string;
  speakerCharacterIds?: string[];
  characterNamesById?: Map<string, string>;
  assetNamesById?: Map<string, string>;
  /** Full project roster used to infer crowd / shortened name mentions not yet on the tray. */
  characterCatalog?: CharacterReferenceCatalogEntry[];
};

export async function loadEffectiveSegmentReferences(segmentId: string, shotIds: string[], referenceMode: string) {
  const db = getDb();
  const shotReferences = shotIds.length
    ? await db.select().from(shotAssetReferences)
      .where(inArray(shotAssetReferences.shotId, shotIds))
      .orderBy(shotAssetReferences.referenceOrder)
    : [];
  const mappedShotRefs = shotReferences.map((reference): EffectiveSegmentReference => ({
    ...reference,
    segmentId: null,
    source: "shot",
  }));

  if (referenceMode === "manual") {
    const references = await db.select().from(segmentAssetReferences)
      .where(eq(segmentAssetReferences.segmentId, segmentId))
      .orderBy(segmentAssetReferences.referenceOrder);
    const mappedSegmentRefs = references.map((reference): EffectiveSegmentReference => ({
      ...reference,
      shotId: null,
      source: "segment",
    }));
    // Keep per-shot storyboard refs even after the creator switches the tray to manual.
    // Generation prefers shot-specific refs; segment tray refs are only the fallback pool.
    return [...mappedSegmentRefs, ...mappedShotRefs];
  }

  return mappedShotRefs;
}

export function buildCharacterReferenceCatalog(
  projectCharacters: Array<{ id: string; canonicalName: string; assetId: string | null }>,
  forms: Array<{ id: string; characterId: string; name?: string | null; assetId: string | null }>,
): CharacterReferenceCatalogEntry[] {
  return projectCharacters.map((character) => {
    const formsForCharacter = forms.filter((form) => form.characterId === character.id);
    const preferred = formsForCharacter.find((form) => /基础|默认|群像|群众/.test(form.name ?? ""))
      ?? formsForCharacter[0]
      ?? null;
    return {
      characterId: character.id,
      canonicalName: character.canonicalName,
      characterFormId: preferred?.id ?? null,
      assetId: preferred?.assetId ?? character.assetId,
    };
  });
}

export function buildShotReferenceContext(options: {
  shot: { id: string; title?: string | null; prompt?: string | null };
  dialogueLines?: Array<{ shotId: string; speakerCharacterId: string | null }>;
  characters?: Array<{ id: string; canonicalName: string }>;
  assets?: Array<{ id: string; name: string }>;
  characterCatalog?: CharacterReferenceCatalogEntry[];
}): ShotReferenceContext {
  const speakerCharacterIds = (options.dialogueLines ?? [])
    .filter((line) => line.shotId === options.shot.id && line.speakerCharacterId)
    .map((line) => line.speakerCharacterId as string);
  return {
    shotTitle: options.shot.title ?? "",
    shotPrompt: options.shot.prompt ?? "",
    speakerCharacterIds,
    characterNamesById: new Map((options.characters ?? []).map((character) => [character.id, character.canonicalName])),
    assetNamesById: new Map((options.assets ?? []).map((asset) => [asset.id, asset.name])),
    characterCatalog: options.characterCatalog,
  };
}

function referenceIdentityKey(reference: EffectiveSegmentReference) {
  if (reference.characterFormId) return `character_form:${reference.characterFormId}`;
  if (reference.characterId) return `character:${reference.characterId}`;
  if (reference.assetId) return `${reference.referenceRole}:${reference.assetId}`;
  return `reference:${reference.id}`;
}

function dedupeReferences(references: EffectiveSegmentReference[]) {
  const seen = new Set<string>();
  const result: EffectiveSegmentReference[] = [];
  for (const reference of references) {
    const key = referenceIdentityKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function characterMatchesShot(reference: EffectiveSegmentReference, context: ShotReferenceContext, haystack: string, speakers: Set<string>) {
  if (reference.characterId && speakers.has(reference.characterId)) return true;
  const name = reference.characterId
    ? context.characterNamesById?.get(reference.characterId)
      ?? context.characterCatalog?.find((item) => item.characterId === reference.characterId)?.canonicalName
    : null;
  return Boolean(name && characterNameMentionedInText(name, haystack));
}

function inferCatalogCharacterRefs(context: ShotReferenceContext, haystack: string, speakers: Set<string>, existing: EffectiveSegmentReference[]) {
  const existingKeys = new Set(existing.map(referenceIdentityKey));
  const existingCharacterIds = new Set(existing.flatMap((reference) => reference.characterId ? [reference.characterId] : []));
  const inferred: EffectiveSegmentReference[] = [];
  for (const entry of context.characterCatalog ?? []) {
    const mentioned = speakers.has(entry.characterId) || characterNameMentionedInText(entry.canonicalName, haystack);
    if (!mentioned) continue;
    if (existingCharacterIds.has(entry.characterId)) continue;
    const key = entry.characterFormId ? `character_form:${entry.characterFormId}` : `character:${entry.characterId}`;
    if (existingKeys.has(key)) continue;
    inferred.push({
      id: `inferred:${key}`,
      shotId: null,
      segmentId: null,
      assetId: entry.assetId,
      characterId: entry.characterId,
      characterFormId: entry.characterFormId,
      referenceRole: "character",
      referenceOrder: 100 + inferred.length,
      required: true,
      source: "inferred",
    });
    existingKeys.add(key);
    existingCharacterIds.add(entry.characterId);
  }
  return inferred;
}

/**
 * Pick references for one shot:
 * 1) storyboard per-shot refs win per role when present
 * 2) also keep characters mentioned in the shot prompt (tray + project roster), even if the shot only stored a scene
 * 3) otherwise filter the segment tray by dialogue speakers / name mentions
 * 4) if nothing matches, fall back to the whole segment tray
 */
export function referencesForShot(
  references: EffectiveSegmentReference[],
  shotId: string,
  context: ShotReferenceContext = {},
) {
  const shotSpecific = references.filter((reference) => reference.source === "shot" && reference.shotId === shotId);
  const segmentRefs = references.filter((reference) => reference.source === "segment");
  const haystack = `${context.shotTitle ?? ""}\n${context.shotPrompt ?? ""}`;
  const speakers = new Set((context.speakerCharacterIds ?? []).filter(Boolean));
  const hasContext = Boolean(haystack.trim() || speakers.size);

  const shotCharacters = shotSpecific.filter((reference) => reference.referenceRole === "character");
  const shotScenes = shotSpecific.filter((reference) => reference.referenceRole === "scene");
  const shotProps = shotSpecific.filter((reference) => reference.referenceRole === "prop");
  const segmentCharacters = segmentRefs.filter((reference) => reference.referenceRole === "character");
  const segmentScenes = segmentRefs.filter((reference) => reference.referenceRole === "scene");
  const segmentProps = segmentRefs.filter((reference) => {
    if (reference.referenceRole !== "prop") return false;
    const name = reference.assetId ? context.assetNamesById?.get(reference.assetId) : null;
    return !name || !haystack.trim() || haystack.includes(name);
  });

  const characterPool = dedupeReferences([...shotCharacters, ...segmentCharacters]);
  const matchedFromPool = characterPool.filter((reference) => characterMatchesShot(reference, context, haystack, speakers));
  let characters = shotCharacters.length
    ? dedupeReferences([...shotCharacters, ...matchedFromPool])
    : matchedFromPool;
  if (!characters.length && !hasContext) characters = characterPool;
  if (!characters.length && !shotSpecific.length && segmentCharacters.length) characters = segmentCharacters;

  characters = dedupeReferences([
    ...characters,
    ...inferCatalogCharacterRefs(context, haystack, speakers, characters),
  ]);

  const scenes = shotScenes.length ? shotScenes : segmentScenes.slice(0, 1);
  const props = shotProps.length ? shotProps : segmentProps;
  const picked = dedupeReferences([...characters, ...scenes, ...props]);
  if (picked.length) return picked;
  if (shotSpecific.length) return shotSpecific;
  return segmentRefs;
}

export function buildGenerationReferencePayload(
  references: EffectiveSegmentReference[],
  formReferenceImages: Array<{ characterFormId: string; assetId: string; isPrimary?: boolean; referenceType?: string | null }>,
) {
  const characterImageAssetIds = [...new Set(references
    .filter((reference) => reference.referenceRole === "character")
    .flatMap((reference) => {
      // One primary portrait per character — never dump the whole turnaround pack into storyboard.
      if (reference.assetId) return [reference.assetId];
      if (!reference.characterFormId) return [];
      const pack = formReferenceImages.filter((item) => item.characterFormId === reference.characterFormId);
      const primary = pack.find((item) => item.isPrimary)
        ?? pack.find((item) => item.referenceType === "front" || item.referenceType === "primary")
        ?? pack[0];
      return primary?.assetId ? [primary.assetId] : [];
    }))].slice(0, 2);
  const sceneAssetIds = [...new Set(references.filter((reference) => reference.referenceRole === "scene" && reference.assetId).map((reference) => reference.assetId as string))];
  const propImageAssetIds = [...new Set(references.filter((reference) => reference.referenceRole === "prop" && reference.assetId).map((reference) => reference.assetId as string))].slice(0, 1);
  return {
    characterImageAssetIds,
    sceneAssetId: sceneAssetIds[0] ?? null,
    sceneAssetIds: sceneAssetIds.slice(0, 1),
    propImageAssetIds,
    // Prefer structured slots; keep flat list lean for workflows that only accept referenceImages.
    referenceAssetIds: [...new Set([...characterImageAssetIds, ...sceneAssetIds.slice(0, 1)])].slice(0, 3),
  };
}
