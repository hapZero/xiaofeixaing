"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import { CanvasOverlay } from "../canvas/CanvasWorkspace";
import { ProjectTop } from "../project/ProjectTop";
import { roleImages, sceneImages } from "../studio/media";
import type { View } from "../studio/types";

type AssetTab = "角色" | "场景" | "道具" | "素材";
const assetCounts: Record<AssetTab, number> = { 角色: 5, 场景: 11, 道具: 1, 素材: 1 };

export function AssetsPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [tab, setTab] = useState<AssetTab>("角色");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const roles = [
    ["林微", "主角 · 2 个形象", roleImages[0]],
    ["陈屹", "2 个形象", roleImages[1]],
    ["张曼", "1 个形象", roleImages[2]],
    ["王老师", "2 个形象", roleImages[3]],
    ["男同学", "1 个形象", roleImages[1]],
  ];
  const scenes = [
    ["县城老中学旧教室", "3 个场景状态", sceneImages[0]],
    ["教学楼旧走廊", "2 个场景状态", sceneImages[1]],
    ["档案办公室", "1 个场景状态", sceneImages[2]],
    ["学校操场", "2 个场景状态", sceneImages[3]],
  ];
  return (
    <StudioShell view="assets" onNavigate={onNavigate}>
      <ProjectTop step={2} onNavigate={onNavigate} />
      <div className="assets-page">
        <div className="assets-heading">
          <div><p className="eyebrow">全剧资产</p><h2>确认角色与场景的一致性</h2><p>这些设定会应用到整部剧集，调整完成后再进入分镜生成。</p></div>
          <AppButton onClick={() => setCanvasOpen(true)}>⌘ 去画布编辑</AppButton>
        </div>
        <div className="asset-tabs">
          {(Object.keys(assetCounts) as AssetTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<span>{assetCounts[item]}</span></button>)}
        </div>
        <div className="asset-toolbar"><div><button className="active">全部</button><button>待确认 2</button><button>已确认 16</button></div><div><button>⌕ 搜索资产</button><button>↕ 最近生成</button><button>▦</button></div></div>
        {tab === "角色" && <div className="asset-grid role-grid">
          {roles.map(([name, meta, image], index) => (
            <button className="asset-card" key={name} onClick={index === 0 ? () => setVoiceOpen(true) : undefined}>
              <div className="asset-image portrait" style={{ backgroundImage: `url(${image})` }}><span className={index < 3 ? "confirmed" : "review"}>{index < 3 ? "已确认" : "待确认"}</span>{index === 0 && <em>主角</em>}<i className="voice-badge">♬</i></div>
              <div className="asset-card-info"><div><h3>{name}</h3><p>{meta}</p></div><b>···</b></div>
            </button>
          ))}
          <button className="asset-add"><span>＋</span><h3>添加角色</h3><p>上传参考图或生成新角色</p></button>
        </div>}
        {tab === "场景" && <div className="asset-grid scene-grid">{scenes.map(([name, meta, image], index) => <button className="asset-card" key={name}><div className="asset-image landscape" style={{ backgroundImage: `url(${image})` }}><span className={index < 3 ? "confirmed" : "review"}>{index < 3 ? "已确认" : "待确认"}</span></div><div className="asset-card-info"><div><h3>{name}</h3><p>{meta}</p></div><b>···</b></div></button>)}<button className="asset-add landscape-add"><span>＋</span><h3>添加场景</h3><p>上传参考图或生成新场景</p></button></div>}
        {tab === "道具" && <div className="empty-assets"><div className="prop-visual">✉</div><h3>未寄出的旧信</h3><p>出现于第 1、2、3 集 · 已确认</p></div>}
        {tab === "素材" && <div className="empty-assets"><div className="prop-visual audio">♪</div><h3>90年代校园环境氛围</h3><p>音频素材 · 01:30 · 已确认</p></div>}
        <div className="asset-page-footer"><AppButton onClick={() => onNavigate("script")}>← 上一步</AppButton><div><span>18 项资产中，16 项已确认</span><AppButton primary onClick={() => onNavigate("videos")}>确认资产，生成分镜 →</AppButton></div></div>
      </div>
      {voiceOpen && <VoiceModal onClose={() => setVoiceOpen(false)} />}
      {canvasOpen && <CanvasOverlay onClose={() => setCanvasOpen(false)} onContinue={() => { setCanvasOpen(false); onNavigate("videos"); }} />}
    </StudioShell>
  );
}

function VoiceModal({ onClose }: { onClose: () => void }) {
  const [voiceMode, setVoiceMode] = useState<"文本音色" | "上传音频" | "AI生成" | "已有音频">("文本音色");
  const [playing, setPlaying] = useState(false);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="voice-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="eyebrow">角色详情</p><h2>林微 · 基础形象</h2></div><button onClick={onClose}>×</button></div>
        <div className="voice-modal-body">
          <div className="role-preview" style={{ backgroundImage: `url(${roleImages[0]})` }}><span>主图</span><button>更换形象</button></div>
          <div className="role-form">
            <div className="form-row"><label>角色名称<input defaultValue="林微" /></label><label>形象名称<input defaultValue="成年时期 · 基础形象" /></label></div>
            <label>出现集数<div className="episode-chips"><button className="active">第1集</button><button className="active">第2集</button><button className="active">第3集</button></div></label>
            <div className="voice-section-title"><div><h3>固定角色音色</h3><p>该音色会应用到所有引用此角色的分镜</p></div><span className="saved-state">✓ 已绑定</span></div>
            <div className="voice-mode-tabs">{(["文本音色", "上传音频", "AI生成", "已有音频"] as const).map((item) => <button key={item} className={voiceMode === item ? "active" : ""} onClick={() => setVoiceMode(item)}>{item}</button>)}</div>
            {voiceMode === "文本音色" ? <textarea className="voice-description" defaultValue="女声，青年音色，音调偏中高，质感干净偏软；声音清澈克制，吐字轻缓，语速偏慢，在坚定时保留一丝疲惫感。" /> : <div className="voice-upload-placeholder"><span>{voiceMode === "AI生成" ? "✦" : voiceMode === "已有音频" ? "≡" : "⇧"}</span><h4>{voiceMode === "AI生成" ? "根据角色设定生成匹配音色" : voiceMode === "已有音频" ? "从声音资产中选择" : "上传 10–30 秒清晰人声音频"}</h4><button>选择声音</button></div>}
            <div className="voice-sample"><button className={playing ? "playing" : ""} onClick={() => setPlaying(!playing)}>{playing ? "❚❚" : "▶"}</button><div><b>音色试听</b><span className="sound-wave">||||||||||||||||||||||||||||</span></div><time>00:08</time></div>
          </div>
        </div>
        <div className="modal-footer"><AppButton onClick={onClose}>取消</AppButton><AppButton primary onClick={onClose}>保存角色设置</AppButton></div>
      </div>
    </div>
  );
}

