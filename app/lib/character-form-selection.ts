export type SelectableCharacterForm = {
  id: string;
  characterId: string;
  name: string;
  assetId: string | null;
  episodeScopeJson: string;
};

function episodeScope(form: SelectableCharacterForm): number[] {
  try {
    const parsed = JSON.parse(form.episodeScopeJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0) : [];
  } catch {
    return [];
  }
}

export function selectCharacterFormForShot(forms: SelectableCharacterForm[], episodeNumber: number, prompt: string) {
  return forms
    .map((form) => {
      const scope = episodeScope(form);
      const explicitlyNamed = form.name !== "基础形象" && prompt.includes(form.name);
      const inEpisode = scope.includes(episodeNumber);
      const globallyAvailable = scope.length === 0;
      if (!explicitlyNamed && !inEpisode && !globallyAvailable) return null;
      const score = (explicitlyNamed ? 100 : 0) + (inEpisode ? 50 : 0) + (form.name === "基础形象" ? 10 : 0) + (form.assetId ? 5 : 0);
      return { form, score };
    })
    .filter((item): item is { form: SelectableCharacterForm; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)[0]?.form ?? null;
}
