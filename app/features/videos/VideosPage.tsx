"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import { videoImages } from "../studio/media";
import type { View } from "../studio/types";

export function VideosPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <StudioShell view="videos" onNavigate={onNavigate}>
      <ProjectTop step={3} onNavigate={onNavigate} />
      <div className="videos-page page-scroll">
        <div className="videos-heading"><div><p className="eyebrow">分集视频</p><h2>3 集 · 33 个分镜片段</h2><p>逐集检查分镜脚本和生成结果，确认后再合成完整剧集。</p></div><div><AppButton>批量管理</AppButton><AppButton disabled>＋ 新增一集</AppButton></div></div>
        <div className="episode-video-list">
          {[
            ["第1集", "旧教室重逢揭开尘封往事", "01:54", "10", videoImages[0]],
            ["第2集", "十七年真相浮出水面", "01:56", "12", videoImages[1]],
            ["第3集", "十七年误解一朝解开", "02:08", "11", videoImages[2]],
          ].map(([ep, title, duration, shots, image], index) => (
            <article className="episode-video-card" key={ep}>
              <button className="episode-thumb" style={{ backgroundImage: `url(${image})` }} onClick={() => setPreview(index)}><span className="play-orb">▶</span><time>{duration}</time></button>
              <div className="episode-video-info"><div className="episode-state"><span>✓ 已完成</span><small>最后生成于今天 15:{32 + index}</small></div><p>{ep}</p><h3>{title}</h3><div className="episode-stats"><span>角色 {index === 0 ? 4 : 5}</span><i /> <span>场景 {3 + index}</span><i /><span>分镜 {shots}</span></div></div>
              <div className="episode-actions"><AppButton onClick={() => setPreview(index)}>预览</AppButton><AppButton primary onClick={() => onNavigate("editor")}>编辑分镜</AppButton><button className="more-button">···</button></div>
            </article>
          ))}
        </div>
        <div className="videos-footer"><AppButton onClick={() => onNavigate("assets")}>← 上一步</AppButton><div><span><i className="status-dot" />3 集视频已完成</span><AppButton primary onClick={() => setPreview(0)}>预览整部短剧 →</AppButton></div></div>
      </div>
      {preview !== null && <div className="modal-backdrop" onMouseDown={() => setPreview(null)}><div className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreview(null)}>×</button><div className="preview-video" style={{ backgroundImage: `url(${videoImages[preview]})` }}><span className="large-play">▶</span><div className="preview-timeline"><i style={{ width: "31%" }} /><b /></div></div><div className="preview-info"><div><small>第 {preview + 1} 集</small><h3>{["旧教室重逢揭开尘封往事", "十七年真相浮出水面", "十七年误解一朝解开"][preview]}</h3></div><AppButton primary onClick={() => { setPreview(null); onNavigate("editor"); }}>进入分镜编辑</AppButton></div></div></div>}
    </StudioShell>
  );
}

