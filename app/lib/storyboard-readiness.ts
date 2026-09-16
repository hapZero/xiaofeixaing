import { visualAssetMediaReady } from "./visual-asset-approval.ts";

type TimelineEpisode = {
  episodeNumber: number;
  segments: Array<{ shots: unknown[] }>;
};

type ReadinessAsset = {
  id: string;
  assetType: string;
  name: string;
  status: string;
  storageKey: string | null;
  metadataJson: string;
};

type ReadinessCharacterForm = {
  id: string;
  name: string;
  assetId: string | null;
};

export function structuredEpisodesFromTimeline(timelineJson: string | null | undefined): TimelineEpisode[] {
  if (!timelineJson) return [];
  try {
    const parsed = JSON.parse(timelineJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((episode): episode is TimelineEpisode => {
      if (!episode || typeof episode !== "object") return false;
      const value = episode as { episodeNumber?: unknown; segments?: unknown };
      return typeof value.episodeNumber === "number"
        && Array.isArray(value.segments)
        && value.segments.some((segment) => segment && typeof segment === "object" && Array.isArray((segment as { shots?: unknown }).shots));
    });
  } catch {
    return [];
  }
}

export function getStoryboardGenerationBlockers(input: {
  episodeCount: number;
  timelineJson: string | null | undefined;
  assets: ReadinessAsset[];
  characterForms: ReadinessCharacterForm[];
}): string[] {
  const blockers: string[] = [];
  if (!input.episodeCount) blockers.push("项目还没有分集剧本，请先在「剧本大纲」完成分集。");

  if (!structuredEpisodesFromTimeline(input.timelineJson).length) {
    blockers.push("还没有分镜级片段与镜头草案，请回到「资产库」点击「重新提取资产」。");
  }

  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const unapprovedVisuals = [
    ...input.characterForms.flatMap((form) => {
      const asset = form.assetId ? assetById.get(form.assetId) : null;
      return visualAssetMediaReady(asset) ? [] : [`角色形态「${form.name}」`];
    }),
    ...input.assets.filter((asset) => ["scene", "prop"].includes(asset.assetType)).flatMap((asset) => (
      visualAssetMediaReady(asset) ? [] : [`${asset.assetType === "scene" ? "场景" : "道具"}「${asset.name}」`]
    )),
  ];
  if (unapprovedVisuals.length) {
    const preview = unapprovedVisuals.slice(0, 3).join("、");
    blockers.push(`还有 ${unapprovedVisuals.length} 项视觉资产尚未生成：${preview}${unapprovedVisuals.length > 3 ? " 等" : ""}。请回到「资产库」批量生成或单独补图。`);
  }

  return blockers;
}
