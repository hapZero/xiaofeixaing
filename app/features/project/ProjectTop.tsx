import { Pill } from "../../components/ui";
import type { View } from "../studio/types";

export function ProjectTop({
  step,
  onNavigate,
  title = "未命名项目",
  stylePreset = "写实电影风格",
  aspectRatio = "16:9",
  saveState = "已保存",
}: {
  step: 1 | 2 | 3;
  onNavigate: (view: View) => void;
  title?: string;
  stylePreset?: string;
  aspectRatio?: string;
  saveState?: string;
}) {
  const steps: Array<[number, string, View]> = [
    [1, "剧本大纲", "script"],
    [2, "资产库", "assets"],
    [3, "分集视频", "videos"],
  ];
  return (
    <div className="project-top">
      <button className="project-back" onClick={() => onNavigate("drama")}>‹</button>
      <div className="project-name"><h1>{title}</h1><span>{saveState}</span></div>
      <div className="project-steps">
        {steps.map(([number, label, target]) => (
          <button key={number} className={`${step === number ? "active" : ""} ${number < step ? "done" : ""}`} onClick={() => onNavigate(target)}>
            <span>{number < step ? "✓" : number}</span>{label}
          </button>
        ))}
      </div>
      <div className="project-settings"><Pill>{stylePreset}</Pill><Pill>{aspectRatio}</Pill></div>
    </div>
  );
}
