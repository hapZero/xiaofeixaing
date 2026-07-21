"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import type { View } from "../studio/types";

export function ScriptPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [episode, setEpisode] = useState(1);
  const [tab, setTab] = useState<"原始创意" | "剧本摘要" | "分集剧本">("分集剧本");
  const [extracting, setExtracting] = useState(false);
  const [locked, setLocked] = useState(false);
  const extract = () => {
    setExtracting(true);
    window.setTimeout(() => { setExtracting(false); setLocked(true); }, 1200);
  };
  return (
    <StudioShell view="script" onNavigate={onNavigate}>
      <ProjectTop step={1} onNavigate={onNavigate} />
      <div className="project-body script-body">
        <aside className="episode-sidebar">
          <div><h3>分集剧本</h3><Pill>3 集</Pill></div>
          {[1, 2, 3].map((item) => (
            <button key={item} className={episode === item ? "active" : ""} onClick={() => setEpisode(item)}>
              <span>0{item}</span><div><b>{item === 1 ? "旧教室重逢" : item === 2 ? "十七年真相" : "误解终于解开"}</b><small>{item === 3 ? "待确认" : locked ? "资产已提取" : "剧本已生成"}</small></div><i className={item === 3 ? "pending" : "ready"} />
            </button>
          ))}
          <button className="add-episode">＋ 新增一集</button>
        </aside>
        <main className="script-workspace">
          <div className="workspace-header">
            <div><p className="eyebrow">第 {episode} 集</p><h2>{episode === 1 ? "旧教室重逢揭开尘封往事" : episode === 2 ? "十七年真相浮出水面" : "十七年误解一朝解开"}</h2></div>
            <div><AppButton>批量选择</AppButton><AppButton>重新生成</AppButton></div>
          </div>
          <div className="content-tabs">
            {(["原始创意", "剧本摘要", "分集剧本"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
          </div>
          {tab !== "分集剧本" ? (
            <div className="summary-card"><h3>{tab}</h3><p>{tab === "原始创意" ? "十七年前，一封没有寄出的信让五个人的人生走向完全不同的方向。多年后，他们在即将拆除的旧教学楼里再次相遇。" : "林微回到县城老中学整理旧物，在旧教室遇见多年未见的陈屹。一次意外发现，让两人重新追查当年被掩盖的真相。"}</p></div>
          ) : (
            <div className={`episode-script ${locked ? "locked" : ""}`}>
              {locked && <div className="lock-banner"><span>⌁</span><div><b>资产已拆解，本集剧本已锁定</b><p>角色、场景和道具已进入资产库，修改剧本可能影响后续内容。</p></div></div>}
              <div className="scene-block"><div className="scene-number">01</div><div><h3>旧教室 · 日 · 内</h3><p className="scene-meta">人物：林微　场景：县城老中学旧教室</p><p>阳光从落满灰尘的窗户斜照进来。林微蹲在一堆旧物前，手机开着免提。</p><p><b>画外音（中年女性）：</b>微姐，那男的条件真不错，你就去见一面呗？</p><p><b>林微：</b>我习惯一个人了，这样挺好。</p></div></div>
              <div className="scene-block"><div className="scene-number">02</div><div><h3>旧走廊 · 日 · 内</h3><p className="scene-meta">人物：林微、陈屹　场景：教学楼旧走廊</p><p>走廊尽头传来缓慢的脚步声。林微抬起头，十七年未见的陈屹站在逆光中。</p><p><b>陈屹：</b>你果然还是回来了。</p></div></div>
            </div>
          )}
          <div className="script-footer">
            <div><span className="status-dot" />3 集剧本已生成，2 集等待资产提取</div>
            {locked ? <AppButton primary onClick={() => onNavigate("assets")}>进入资产库 →</AppButton> : <AppButton primary onClick={extract}>{extracting ? "正在提取资产…" : "提取角色与场景 →"}</AppButton>}
          </div>
        </main>
      </div>
    </StudioShell>
  );
}

