import { Pill } from "../../components/ui";
import { resolveProjectStepNavigation, type ProjectWorkflowStep } from "../../lib/project-step-navigation";
import type { ProjectSummary, View } from "../studio/types";

export function ProjectTop({
  step,
  project,
  onNavigate,
  title = "未命名项目",
  stylePreset = "写实电影风格",
  aspectRatio = "16:9",
  saveState = "已保存",
}: {
  step: ProjectWorkflowStep;
  project?: ProjectSummary | null;
  onNavigate: (view: View) => void;
  title?: string;
  stylePreset?: string;
  aspectRatio?: string;
  saveState?: string;
}) {
  const { unlocked, completed, stepTargets } = resolveProjectStepNavigation(project);
  const steps: Array<[ProjectWorkflowStep, string]> = [
    [1, "剧本大纲"],
    [2, "资产库"],
    [3, "分集视频"],
  ];

  return (
    <div className="project-top">
      <button type="button" className="project-back" onClick={() => onNavigate("drama")}>‹</button>
      <div className="project-name"><h1>{title}</h1><span>{saveState}</span></div>
      <div className="project-steps">
        {steps.map(([number, label]) => {
          const isActive = step === number;
          const isDone = completed.has(number);
          const isLocked = !unlocked.has(number);
          return (
            <button
              key={number}
              type="button"
              className={`${isActive ? "active" : ""} ${isDone ? "done" : ""} ${isLocked ? "locked" : ""}`}
              disabled={isLocked}
              title={isLocked ? "请先完成上一步" : undefined}
              aria-disabled={isLocked}
              onClick={() => {
                if (isLocked) return;
                onNavigate(stepTargets[number]);
              }}
            >
              <span>{isDone ? "✓" : number}</span>{label}
            </button>
          );
        })}
      </div>
      <div className="project-settings"><Pill>{stylePreset}</Pill><Pill>{aspectRatio}</Pill></div>
    </div>
  );
}
