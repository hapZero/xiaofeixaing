import { Pill } from "../../components/ui";
import type { View } from "../studio/types";

export function ProjectTop({
  step,
  onNavigate,
}: {
  step: 1 | 2 | 3;
  onNavigate: (view: View) => void;
}) {
  const steps: Array<[number, string, View]> = [
    [1, "剧本大纲", "script"],
    [2, "资产库", "assets"],
    [3, "分集视频", "videos"],
  ];
  return (
    <div className="project-top">
      <button className="project-back" onClick={() => onNavigate("drama")}>‹</button>
      <div className="project-name"><h1>旧教室的第三排</h1><span>自动保存于 15:32</span></div>
      <div className="project-steps">
        {steps.map(([number, label, target]) => (
          <button key={number} className={`${step === number ? "active" : ""} ${number < step ? "done" : ""}`} onClick={() => onNavigate(target)}>
            <span>{number < step ? "✓" : number}</span>{label}
          </button>
        ))}
      </div>
      <div className="project-settings"><Pill>90年代写实电影风格</Pill><Pill>16:9</Pill></div>
    </div>
  );
}

