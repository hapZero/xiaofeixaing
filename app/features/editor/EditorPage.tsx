"use client";

import { useMemo, useState } from "react";
import { AppButton, Pill } from "../../components/ui";
import { roleImages, sceneImages, videoImages } from "../studio/media";
import type { View } from "../studio/types";

export function EditorPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [segment, setSegment] = useState(0);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const segments = useMemo(() => [15, 11, 9, 9, 15, 13, 12, 10, 10, 10], []);
  const regenerate = () => {
    setGenerating(true);
    window.setTimeout(() => { setGenerating(false); setHistoryOpen(true); }, 1400);
  };
  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <button className="editor-back" onClick={() => onNavigate("videos")}>‹</button><div className="editor-title"><b>第1集 · 旧教室重逢揭开尘封往事</b><span>已自动保存</span></div>
        <div className="editor-config"><Pill>视频模型 2.0 Fast⌄</Pill><Pill>720P⌄</Pill><Pill>90年代写实电影</Pill><Pill>16:9</Pill></div>
        <div className="editor-top-actions"><AppButton>导出</AppButton><AppButton primary>合成整集</AppButton><button className="profile-avatar">Z</button></div>
      </header>
      <div className="editor-layout">
        <aside className="editor-assets">
          <div className="editor-assets-tabs"><button className="active">本集</button><button>全集</button></div>
          <div className="editor-category-tabs"><button className="active">角色</button><button>场景</button><button>素材</button><button>道具</button></div>
          <h4>角色</h4>
          <div className="mini-asset-grid">{roleImages.slice(0, 4).map((image, index) => <button key={image}><div style={{ backgroundImage: `url(${image})` }} /><span>{["林微", "林微·学生", "王老师", "陈屹"][index]}</span></button>)}</div>
          <h4>场景</h4>
          <div className="mini-scenes">{sceneImages.slice(0, 3).map((image, index) => <button key={image}><div style={{ backgroundImage: `url(${image})` }} /><span>{["废弃旧教室", "旧走廊", "档案办公室"][index]}</span></button>)}</div>
        </aside>
        <main className="storyboard-panel">
          <div className="storyboard-heading"><div><p className="eyebrow">当前片段</p><h2>片段 {String(segment + 1).padStart(2, "0")}</h2></div><div className="credit-note">每 1 秒调用 1 次视频能力</div></div>
          <div className="referenced-assets"><span>已引用</span><button><i style={{ backgroundImage: `url(${sceneImages[0]})` }} />旧教室</button><button><i style={{ backgroundImage: `url(${roleImages[0]})` }} />林微</button><button>＋ @ 引用资产</button></div>
          <div className={`shot-script ${editing ? "editing" : ""}`}>
            <p className="setting-line">本片段场景设定在 <b>@县城老中学 · 旧教室</b>，生成一个由以下 3 个镜头组成的视频。</p>
            <div className="shot-row"><div className="shot-index"><span>01</span><button>{editing ? "4秒⌄" : "4s"}</button></div><div><h4>建立空间</h4><p>远景，固定机位，平视拍摄空无一人的县城老中学旧教室。阳光透过布满灰尘的窗户形成光柱，色彩饱和度低，呈现90年代胶片质感。画面中所有角色全程不说话。</p></div></div>
            <div className="shot-row"><div className="shot-index"><span>02</span><button>{editing ? "5秒⌄" : "5s"}</button></div><div><h4>画外音进入</h4><p>中景，俯视机位。<b>@林微</b> 蹲在旧物旁安静整理，手机放在一旁并开启免提。画外音响起：“微姐，那男的条件真不错，你就去见一面呗？”</p><div className="audio-cue"><span>♬</span><b>画外音</b><small>中年女性 · 热情 · 电话质感</small><button>▶</button></div></div></div>
            <div className="shot-row"><div className="shot-index"><span>03</span><button>{editing ? "6秒⌄" : "6s"}</button></div><div><h4>人物回应</h4><p>近景，85mm中长焦。<b>@林微</b> 面朝手机，温和但坚定地开口说：“我习惯一个人了，这样挺好，不麻烦别人，也不指望谁。”说完按下挂断键。</p><div className="audio-cue voice-fixed"><span>♬</span><b>林微 · 固定音色</b><small>青年女声 · 克制坚定</small><button>▶</button></div></div></div>
          </div>
          <div className="storyboard-actions">{editing ? <><AppButton onClick={() => setEditing(false)}>取消</AppButton><AppButton primary onClick={() => setEditing(false)}>保存分镜</AppButton></> : <><AppButton onClick={() => setEditing(true)}>编辑分镜</AppButton><AppButton primary onClick={regenerate}>{generating ? "正在生成新版本…" : "重新生成片段"}</AppButton></>}</div>
        </main>
        <aside className="video-preview-panel">
          <div className="video-stage" style={{ backgroundImage: `url(${videoImages[segment % 3]})` }}><span className="large-play">▶</span><div className="video-stage-top"><Pill dark>当前版本 V3</Pill></div><div className="video-controls"><span>00:0{Math.min(segment + 1, 9)}</span><div><i style={{ width: `${18 + segment * 4}%` }} /><b /></div><span>00:{segments[segment]}</span></div></div>
          <div className="preview-tools"><button>▧<span>原视频</span></button><button>◇<span>提升画质</span></button><button>⌁<span>擦除字幕</span></button><button>⇩<span>下载</span></button></div>
          <div className="sound-continuity"><div><span>≈</span><div><b>声音连续性</b><p>同场景环境音已跨片段延续</p></div></div><i>已开启</i></div>
        </aside>
      </div>
      <div className="timeline-panel">
        <div className="timeline-header"><div><b>分镜片段</b><span>10 个片段 · 01:54</span></div><div><button>多选</button><button>智能预演</button></div></div>
        <div className="timeline-strip">{segments.map((duration, index) => <div key={index} className={`timeline-item ${segment === index ? "active" : ""}`} role="button" tabIndex={0} onClick={() => setSegment(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSegment(index); }}><div style={{ backgroundImage: `url(${videoImages[index % 3]})` }}><span>0{index + 1}</span><i>✓</i></div><p>{duration}s</p><button className="history-trigger" aria-label={`查看分镜 ${index + 1} 的历史版本`} onClick={(event) => { event.stopPropagation(); setSegment(index); setHistoryOpen(true); }}>↺</button></div>)}</div>
      </div>
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="history-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-heading"><div><p className="eyebrow">片段 01</p><h2>历史版本</h2></div><button onClick={onClose}>×</button></div>
        <p className="drawer-intro">每次重新生成都会保留旧结果，你可以随时切换当前版本。</p>
        {[0, 1, 2].map((index) => <button key={index} className={`version-card ${selected === index ? "active" : ""}`} onClick={() => setSelected(index)}><div style={{ backgroundImage: `url(${videoImages[index]})` }}><span>▶</span></div><section><h3>版本 V{3 - index} {index === 0 && <em>当前使用</em>}</h3><p>视频模型 2.0 Fast · 720P · 15秒</p><small>{index === 0 ? "刚刚生成" : `${index + 1} 小时前`}</small></section><i>{selected === index ? "●" : "○"}</i></button>)}
        <div className="version-prompt"><h4>本次生成描述</h4><p>近景，85mm中长焦。林微面朝手机，温和但坚定地说出台词，随后按下挂断键。保持角色音色与旧教室环境声连续。</p></div>
        <div className="drawer-actions"><AppButton>下载版本</AppButton><AppButton primary onClick={onClose}>{selected === 0 ? "正在使用" : "设为当前版本"}</AppButton></div>
      </aside>
    </div>
  );
}

