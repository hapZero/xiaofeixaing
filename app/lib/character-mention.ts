/** Crowd / nameless roles that scripts often shorten (弟子 vs 弟子甲乙丙). */
const GENERIC_NAME_PATTERNS = [
  /弟子/,
  /门徒/,
  /修士/,
  /路人/,
  /行人/,
  /群众/,
  /众人/,
  /人群/,
  /观众/,
  /守卫/,
  /侍从/,
  /侍卫/,
  /官兵/,
  /士兵/,
  /衙役/,
  /太监/,
  /宫女/,
  /丫鬟/,
  /仆人/,
  /随从/,
  /小贩/,
  /商人/,
  /老板/,
  /掌柜/,
  /伙计/,
  /乞丐/,
  /食客/,
  /刺客/,
  /杀手/,
  /黑衣人/,
  /白衣人/,
  /蒙面/,
  /神秘人/,
  /老者/,
  /少年/,
  /少女/,
  /孩童/,
  /壮汉/,
  /男子/,
  /女子/,
  /汉子/,
  /姑娘/,
  /青年/,
  /中年/,
  /老人/,
];

export function isGenericCrowdCharacterName(name: string) {
  return GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(name.trim()));
}

/**
 * Whether a roster character name is referenced by shot title/prompt text.
 * Handles exact names, shortened forms (弟子甲乙 → 弟子甲乙丙), and crowd generics (弟子 → 弟子甲乙丙).
 */
export function characterNameMentionedInText(name: string, haystack: string) {
  const characterName = name.trim();
  const text = haystack.trim();
  if (!characterName || !text) return false;
  if (text.includes(characterName)) return true;

  // Prompt often drops the last character of a compound crowd label.
  if (characterName.length >= 3) {
    for (let length = characterName.length - 1; length >= 2; length -= 1) {
      if (text.includes(characterName.slice(0, length))) return true;
    }
  }

  if (!isGenericCrowdCharacterName(characterName)) return false;
  return GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(characterName) && pattern.test(text));
}
