"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { videoImages } from "../studio/media";
import type { View } from "../studio/types";

export function DramaHub({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [mode, setMode] = useState<"上传剧本" | "AI 生剧本" | "自由画布">("上传剧本");
  const [text, setText] = useState("");
  return (
    <StudioShell view="drama" onNavigate={onNavigate}>
      <div className="drama-page page-scroll">
        <section className="drama-header">
          <Pill>短剧 Agent 2.0</Pill>
          <h1>把故事交给小飞象，<br />一个人也能完成一部短剧。</h1>
          <p>从剧本拆解、角色资产到分镜成片，保留每一步创作控制权。</p>
        </section>
        <section className="create-project-panel">
          <div className="create-tabs">
            {(["上传剧本", "AI 生剧本", "自由画布"] as const).map((tab) => (
              <button key={tab} className={mode === tab ? "active" : ""} onClick={() => setMode(tab)}>{tab}</button>
            ))}
          </div>
          {mode === "上传剧本" && (
            <div className="upload-layout">
              <button className="upload-zone" onClick={() => setText("第1集：旧教室重逢揭开尘封往事…") }>
                <span className="upload-icon">⇧</span><h3>上传完整剧本</h3><p>支持 TXT、DOCX、PDF，或拖拽文件到这里</p><em>最多支持 10 万汉字</em>
              </button>
              <div className="or-divider"><span>或</span></div>
              <div className="paste-area">
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="直接粘贴剧本文本…" />
                <div><span>{text.length} 字</span><AppButton primary onClick={() => onNavigate("script")}>创建短剧项目 →</AppButton></div>
              </div>
            </div>
          )}
          {mode === "AI 生剧本" && (
            <div className="ai-script-panel">
              <textarea defaultValue="十七年前，一名女学生在废弃教室里留下了一封没有寄出的信。多年后，她重返校园，发现当年的所有人都隐瞒了同一个秘密。" />
              <div className="ai-options"><Pill>90年代写实电影⌄</Pill><Pill>16:9⌄</Pill><Pill>3 集⌄</Pill><Pill>悬疑短剧⌄</Pill></div>
              <AppButton primary onClick={() => onNavigate("script")}>生成剧本大纲 →</AppButton>
            </div>
          )}
          {mode === "自由画布" && (
            <div className="free-canvas-intro">
              <div className="canvas-preview-mini"><span /><span /><span /><i /><i /></div>
              <div><h3>不从剧本开始，也可以创作</h3><p>上传角色、场景或一张灵感图片，在自由画布里探索故事和视觉方向。</p><AppButton primary onClick={() => onNavigate("canvas")}>进入自由画布 →</AppButton></div>
            </div>
          )}
        </section>
        <section className="project-section">
          <div className="section-title"><div><h2>我的短剧</h2><p>最近更新的创作项目</p></div><button>全部项目 →</button></div>
          <div className="project-grid">
            <button className="project-card" onClick={() => onNavigate("script")}>
              <div className="project-cover" style={{ backgroundImage: `url(${videoImages[0]})` }}><span>制作中</span><div className="project-progress"><i style={{ width: "72%" }} /></div></div>
              <div className="project-info"><h3>旧教室的第三排</h3><p>3集 · 90年代写实电影风格</p><small>更新于 18 分钟前</small></div>
            </button>
            <button className="project-card faded"><div className="project-cover" style={{ backgroundImage: `url(${videoImages[1]})` }}><span>剧本生成失败</span></div><div className="project-info"><h3>十日终焉：天马试炼</h3><p>5集 · 末日悬疑漫剧</p><small>更新于昨天</small></div></button>
            <button className="project-card faded"><div className="project-cover warm-cover"><span>资产准备中</span></div><div className="project-info"><h3>崇祯新变</h3><p>8集 · 古装写实短剧</p><small>更新于3天前</small></div></button>
          </div>
        </section>
      </div>
    </StudioShell>
  );
}

