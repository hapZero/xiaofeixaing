import { isStoryOutlineReady, parseDramaOutlineFromStoryBible, parseOutlineCharactersFromWorld, type OutlineCharacter } from "../../lib/drama-outline";
import { projectScriptPhaseComplete } from "../../lib/project-step-navigation";
import type { ProjectEpisode, ProjectGenerationJob, ProjectSummary, StoryBible } from "../studio/types";

export type { OutlineCharacter };

export type ParsedStoryOutline = {
  plannedEpisodeCount: number;
  readyEpisodeCount: number;
  pendingEpisodeCount: number;
  outlineReady: boolean;
  summaryReady: boolean;
  episodesUnlocked: boolean;
  logline: string;
  genre: string;
  coreHooks: string[];
  targetAudience: string;
  premise: string;
  tone: string;
  characters: OutlineCharacter[];
  generationPhase: "idle" | "generating" | "failed" | "ready";
  generationStep: "outline" | "episodes" | "complete" | null;
  wizardStep: ScriptWizardStep;
};

export type ScriptWizardStep = "idea" | "outline_review" | "episodes" | "confirm";

export function resolveScriptWizardStep(options: {
  sourceType: ProjectSummary["sourceType"] | undefined;
  scriptPhaseComplete: boolean;
  outlineReady: boolean;
  generatingOutline: boolean;
  generatingEpisodes: boolean;
  readyEpisodeCount: number;
  allEpisodesHaveScripts: boolean;
}): ScriptWizardStep {
  if (options.sourceType === "upload") {
    return options.allEpisodesHaveScripts ? "confirm" : "episodes";
  }
  if (options.scriptPhaseComplete && options.allEpisodesHaveScripts) return "confirm";
  if (options.generatingOutline || !options.outlineReady) return "idea";
  if (options.generatingEpisodes || options.readyEpisodeCount > 0) {
    return options.allEpisodesHaveScripts ? "confirm" : "episodes";
  }
  return "outline_review";
}

export function requestedEpisodeCount(generationJobs: ProjectGenerationJob[], episodes: ProjectEpisode[]) {
  const scriptJob = generationJobs.find((job) => job.capability === "llm_script" || job.capability === "llm_structure");
  if (scriptJob?.resultJson) {
    try {
      const count = Number((JSON.parse(scriptJob.resultJson) as { episodeCount?: unknown }).episodeCount);
      if (Number.isFinite(count) && count > 0) return Math.round(count);
    } catch {
      // ignore malformed result
    }
  }
  if (scriptJob?.payloadJson) {
    try {
      const count = Number((JSON.parse(scriptJob.payloadJson) as { episodeCount?: unknown }).episodeCount);
      if (Number.isFinite(count) && count > 0) return Math.round(count);
    } catch {
      // ignore malformed payload
    }
  }
  return Math.max(episodes.length, 1);
}

export function countReadyEpisodes(episodes: ProjectEpisode[], selectedEpisodeId: string | null, selectedScriptText: string) {
  return episodes.filter((episode) => {
    const text = episode.id === selectedEpisodeId ? selectedScriptText : episode.scriptText ?? "";
    return text.trim().length > 0;
  }).length;
}

export function parseStoryOutline(options: {
  project: ProjectSummary | null;
  storyBible: StoryBible | null;
  episodes: ProjectEpisode[];
  generationJobs: ProjectGenerationJob[];
  selectedEpisodeId: string | null;
  selectedScriptText: string;
}): ParsedStoryOutline {
  const parsed = parseDramaOutlineFromStoryBible(options.storyBible);
  const plannedEpisodeCount = requestedEpisodeCount(options.generationJobs, options.episodes);
  const readyEpisodeCount = countReadyEpisodes(options.episodes, options.selectedEpisodeId, options.selectedScriptText);
  const parsedOutlineReady = isStoryOutlineReady(options.storyBible);
  const scriptPhaseComplete = projectScriptPhaseComplete(options.project?.status);
  const episodesComplete = readyEpisodeCount >= plannedEpisodeCount && options.episodes.length > 0;
  const outlineReady = parsedOutlineReady || scriptPhaseComplete || (episodesComplete && Boolean(options.storyBible?.logline?.trim()));
  const scriptGenerationCapabilities = ["llm_script", "llm_structure", "llm_episode"];
  const activeScriptJob = options.generationJobs.find((job) => scriptGenerationCapabilities.includes(job.capability) && ["queued", "running"].includes(job.status));
  const failedTextJob = options.generationJobs.find((job) => ["llm_script", "llm_structure"].includes(job.capability) && job.status === "failed");
  const scriptGenerationFailed = Boolean(failedTextJob)
    || options.project?.status === "script_generation_failed"
    || options.project?.status === "script_structure_failed";
  const generationPhase = activeScriptJob || options.project?.status === "script_generating" || options.project?.status === "script_structuring"
    ? "generating"
    : scriptGenerationFailed && !outlineReady && !scriptPhaseComplete && !episodesComplete
      ? "failed"
      : episodesComplete
        ? "ready"
        : "idle";
  const generationStep = activeScriptJob?.capability === "llm_script" && !outlineReady
    ? "outline"
    : activeScriptJob?.capability === "llm_script" && outlineReady
      ? "episodes"
      : generationPhase === "ready"
        ? "complete"
        : null;
  const generatingOutline = Boolean(activeScriptJob?.capability === "llm_script" && !outlineReady);
  const generatingEpisodes = Boolean(activeScriptJob?.capability === "llm_script" && outlineReady);
  const allEpisodesHaveScripts = episodesComplete;
  const wizardStep = resolveScriptWizardStep({
    sourceType: options.project?.sourceType,
    scriptPhaseComplete,
    outlineReady,
    generatingOutline,
    generatingEpisodes,
    readyEpisodeCount,
    allEpisodesHaveScripts,
  });
  return {
    plannedEpisodeCount,
    readyEpisodeCount,
    pendingEpisodeCount: Math.max(0, plannedEpisodeCount - readyEpisodeCount),
    outlineReady,
    summaryReady: outlineReady,
    episodesUnlocked: outlineReady,
    logline: parsed.logline,
    genre: parsed.genre,
    coreHooks: parsed.coreHooks,
    targetAudience: parsed.targetAudience,
    premise: parsed.premise,
    tone: parsed.tone,
    characters: parsed.characters.length ? parsed.characters : parseOutlineCharactersFromWorld(options.storyBible?.worldJson),
    generationPhase,
    generationStep,
    wizardStep,
  };
}
