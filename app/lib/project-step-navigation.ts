import type { ProjectSummary, View } from "../features/studio/types";

export type ProjectWorkflowStep = 1 | 2 | 3;

const postScriptStatuses = new Set([
  "assets",
  "asset_extraction",
  "asset_review",
  "storyboarding",
  "production",
  "rendering",
  "rendered",
  "delivered",
]);

const postAssetsStatuses = new Set([
  "storyboarding",
  "production",
  "rendering",
  "rendered",
  "delivered",
]);

const stepTargets: Record<ProjectWorkflowStep, View> = {
  1: "script",
  2: "assets",
  3: "videos",
};

export function resolveProjectStepNavigation(project: ProjectSummary | null | undefined) {
  const unlocked = new Set<ProjectWorkflowStep>([1]);
  const completed = new Set<ProjectWorkflowStep>();
  const status = project?.status ?? "draft";

  if (postScriptStatuses.has(status)) {
    completed.add(1);
    unlocked.add(2);
  }
  if (postAssetsStatuses.has(status)) {
    completed.add(2);
    unlocked.add(3);
  }

  return { unlocked, completed, stepTargets };
}

export function projectScriptPhaseComplete(status: string | null | undefined) {
  return postScriptStatuses.has(status ?? "");
}

export function projectAssetsReady(status: string | null | undefined) {
  return status === "assets" || status === "asset_review" || postAssetsStatuses.has(status ?? "");
}

export function friendlyGenerationError(message: string) {
  if (/timeout|aborted due to timeout|AbortError/i.test(message)) {
    if (/LLM_ANALYSIS/i.test(message)) {
      return "完整剧本理解超时。集数较多时需要更久，请再次点击「确认全剧剧本，进入资产库」重试。";
    }
    return "文本智能响应超时。集数较多时需要更久，请稍后点击「继续生成分集」或「重新生成全部分集」重试。";
  }
  if (/LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:/.test(message)) {
    const detail = message.replace(/^LLM_EPISODE_CHARACTER_ROSTER_MISMATCH:/, "").trim();
    return detail
      ? `分集正文里出现了未在人物小传中登记的名字（${detail}）。请点「重新生成全部分集」重试；若确需新角色，请先补充人物小传。`
      : "分集正文与人物小传不一致。请点「重新生成全部分集」重试。";
  }
  return message;
}
