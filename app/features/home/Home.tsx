"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { Pill } from "../../components/ui";
import { videoImages } from "../studio/media";
import type { View } from "../studio/types";

export function Home({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [agentTab, setAgentTab] = useState<"创作 Agent" | "短剧 Agent">("创作 Agent");
  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState(false);
  const send = () => {
    setToast(true);
    window.setTimeout(() => setToast(false), 1800);
  };
  const tools = [
    ["沉浸式短片", "一句灵感，生成有电影感的完整片段", "✦"],
    ["生成图片", "角色、场景与视觉创意快速出图", "▧"],
    ["产品推广", "把商品自然融入故事和镜头", "◈"],
    ["智能长视频", "长内容自动理解与编排", "▷"],
  ];
  return (
    <StudioShell view="home" onNavigate={onNavigate}>
      <div className="home-page page-scroll">
        <div className="announcement"><span>NEW</span> 小飞象短剧 Agent 已支持角色音色与分镜版本管理 <button>×</button></div>
        <section className="agent-hero">
          <p className="eyebrow">HI，创作者</p>
          <h1>今天想把什么故事拍出来？</h1>
          <div className="agent-tabs">
            {(["创作 Agent", "短剧 Agent"] as const).map((tab) => (
              <button key={tab} className={agentTab === tab ? "active" : ""} onClick={() => setAgentTab(tab)}>{tab}</button>
            ))}
          </div>
          <div className="composer-card">
            <textarea
              aria-label="描述你的创作想法"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={agentTab === "短剧 Agent" ? "描述故事，或上传剧本开始制作一部短剧…" : "描述你的想法，用 @ 引用角色、图片、视频或音频…"}
            />
            <div className="composer-bottom">
              <div className="composer-tools">
                <button aria-label="添加附件">＋</button>
                <Pill>通用模型⌄</Pill>
                <Pill>16:9⌄</Pill>
                <Pill>自动时长⌄</Pill>
              </div>
              <div className="composer-actions">
                <label className="canvas-toggle"><span>画布模式</span><input type="checkbox" /><i /></label>
                <button className="send-button" onClick={agentTab === "短剧 Agent" ? () => onNavigate("drama") : send}>↑</button>
              </div>
            </div>
          </div>
          <div className="prompt-chips">
            <button onClick={() => setPrompt("做一个发生在废弃学校里的悬疑短片")}>废弃学校悬疑短片</button>
            <button onClick={() => setPrompt("一位古代将军穿越到现代便利店")}>古代将军来到便利店</button>
            <button onClick={() => setPrompt("根据产品图片制作一支电影感广告")}>电影感产品广告</button>
          </div>
        </section>
        <section className="home-section">
          <div className="section-title"><div><h2>开始创作</h2><p>选择一种方式，让想法更快落地</p></div><button>全部能力 →</button></div>
          <div className="tool-grid">
            {tools.map(([title, desc, icon], index) => (
              <button className="tool-card" key={title} onClick={index === 0 ? send : undefined}>
                <span className={`tool-icon tool-${index}`}>{icon}</span>
                <div><h3>{title}</h3><p>{desc}</p></div><b>↗</b>
              </button>
            ))}
            <button className="tool-card drama-feature" onClick={() => onNavigate("drama")}>
              <span className="tool-icon tool-drama">▣</span>
              <div><div className="mini-tag">核心能力</div><h3>短剧 Agent 2.0</h3><p>从剧本、资产到分镜成片的完整创作流程</p></div><b>↗</b>
            </button>
            <button className="tool-card canvas-feature" onClick={() => onNavigate("canvas")}>
              <span className="tool-icon tool-canvas">⌘</span>
              <div><h3>自由画布</h3><p>组织角色、场景和衍生内容的无限空间</p></div><b>↗</b>
            </button>
          </div>
        </section>
        <section className="home-section showcase-section">
          <div className="section-title"><div><h2>精选创作</h2><p>看看大家正在用小飞象讲什么故事</p></div><button>换一批 ↻</button></div>
          <div className="showcase-grid">
            {[
              ["旧教室的第三排", "悬疑 · 写实电影", videoImages[0]],
              ["失重之后", "科幻 · 概念短片", videoImages[1]],
              ["春日来信", "都市 · 情感短剧", videoImages[2]],
            ].map(([title, category, image]) => (
              <article className="showcase-card" key={title} style={{ backgroundImage: `url(${image})` }}>
                <span className="play-orb">▶</span>
                <div><p>{category}</p><h3>{title}</h3></div>
              </article>
            ))}
          </div>
        </section>
      </div>
      {toast && <div className="toast">演示模式：创作任务已准备好</div>}
    </StudioShell>
  );
}
