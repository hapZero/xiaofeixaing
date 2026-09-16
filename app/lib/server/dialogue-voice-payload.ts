import type { characters, dialogueLines } from "../../../db/schema";

type DialogueLine = typeof dialogueLines.$inferSelect;
type Character = typeof characters.$inferSelect;

export function dialogueVoicePayload(line: DialogueLine, character: Character | null) {
  return {
    text: line.text,
    emotion: line.emotion || "自然",
    voiceDescription: character?.voiceDescription || (line.lineType === "narration" ? "稳定、自然、有叙事感的中文旁白" : "自然清晰的中文人声"),
    voiceReferenceAssetId: line.voiceReferenceAssetId || character?.voiceAssetId || null,
  };
}

export function dialogueVoiceBlockers(
  lines: DialogueLine[],
  characters: Character[],
  options?: { onlyLineId?: string },
) {
  const targets = options?.onlyLineId ? lines.filter((line) => line.id === options.onlyLineId) : lines.filter((line) => !line.audioAssetId);
  return targets.flatMap((line) => {
    const character = characters.find((item) => item.id === line.speakerCharacterId) ?? null;
    const referenceAssetId = line.voiceReferenceAssetId || character?.voiceAssetId || null;
    const description = character?.voiceDescription || "";
    if (character && (!character.voiceLocked || (!referenceAssetId && !description))) {
      return [{ lineId: line.id, characterId: character.id, name: character.canonicalName, reason: "角色音色尚未锁定" }];
    }
    return [];
  });
}
