import { AppButton } from "../../components/ui";
import { useRef, useState, type ReactNode } from "react";
import type { ProjectAsset, ProjectSegment, ProjectShot, SegmentVersion } from "../studio/types";
import { shotVideoCapabilityOptions, type ShotVideoCapability } from "../../lib/shot-video-capability";
import { formatVersionTime, type SegmentReferenceView } from "./segment-workbench";

const roleNames: Record<string, string> = { character: "角色", scene: "场景", prop: "道具", style: "风格", material: "素材" };

export type SegmentReferenceOption = {
  key: string;
  kind: "character" | "character_form" | "scene" | "prop";
  id: string;
  role: "character" | "scene" | "prop";
  name: string;
  description: string;
  imageUrl: string | null;
  ready: boolean;
};

export type SegmentReferenceData = {
  mode: "automatic" | "manual";
  selectedKeys: string[];
  options: SegmentReferenceOption[];
  references: SegmentReferenceView[];
  generationInvalidated?: boolean;
};

export function SegmentAssetSidebar({
  scope,
  category,
  options,
  selectedKeys,
  activeShotKeys,
  activeShotLabel,
  episodeKeys,
  busy,
  referenceWired = false,
  referenceHint,
  onScopeChange,
  onCategoryChange,
  onToggle,
  onOpenAssets,
  onOpenSettings,
}: {
  scope: "episode" | "all";
  category: "character" | "scene" | "prop" | "material";
  options: SegmentReferenceOption[];
  selectedKeys: string[];
  activeShotKeys?: Set<string>;
  activeShotLabel?: string;
  episodeKeys: Set<string>;
  busy: boolean;
  referenceWired?: boolean;
  referenceHint?: string;
  onScopeChange: (scope: "episode" | "all") => void;
  onCategoryChange: (category: "character" | "scene" | "prop" | "material") => void;
  onToggle: (key: string) => void;
  onOpenAssets: () => void;
  onOpenSettings?: () => void;
}) {
  const scoped = scope === "all" || episodeKeys.size === 0
    ? options
    : options.filter((option) => episodeKeys.has(option.key) || selectedKeys.includes(option.key) || activeShotKeys?.has(option.key));
  const filtered = category === "material"
    ? []
    : scoped.filter((option) => option.role === category);
  return <aside className="skylark-asset-sidebar" aria-label="片段资产">
    <header>
      <b>本镜参考图</b>
      <span>{activeShotLabel ? `当前分镜：${activeShotLabel}` : "点底部某个首帧，看这一镜会带谁"}</span>
      <span>{referenceWired ? "黑框=这一镜生成会带进参考图；灰字=本段有但本镜不用。参考图锁身份，不会故意走纯文生图。" : "当前分镜工作流还没接参考图口子。"}</span>
      {referenceHint ? <em className="skylark-asset-wiring-hint">{referenceHint}{!referenceWired && onOpenSettings ? <> · <button type="button" className="skylark-link-btn" onClick={onOpenSettings}>去设置接线</button></> : null}</em> : null}
    </header>
    <div className="skylark-asset-scope">
      <button type="button" className={scope === "episode" ? "active" : ""} onClick={() => onScopeChange("episode")}>本集</button>
      <button type="button" className={scope === "all" ? "active" : ""} onClick={() => onScopeChange("all")}>全集</button>
    </div>
    <div className="skylark-asset-categories">
      {(["character", "scene", "material", "prop"] as const).map((item) => (
        <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => onCategoryChange(item)}>{roleNames[item]}</button>
      ))}
    </div>
    <div className="skylark-asset-list">
      {filtered.map((option) => {
        const usedByShot = Boolean(activeShotKeys?.has(option.key));
        const selected = selectedKeys.includes(option.key);
        const className = [
          usedByShot ? "selected shot-active" : selected ? "segment-only" : "",
          option.ready ? "ready" : "missing",
        ].filter(Boolean).join(" ");
        const label = usedByShot
          ? (referenceWired ? "本镜生成会用" : "本镜会用 · 工作流未接图")
          : selected
            ? "本段有 · 本镜不用"
            : option.ready ? "点击引用到本段" : "未就绪";
        return <button type="button" key={option.key} className={className} disabled={busy} onClick={() => onToggle(option.key)} title={label}>
          <i style={option.imageUrl ? { backgroundImage: `url(${option.imageUrl})` } : undefined}>{!option.imageUrl && "◇"}</i>
          <span><b>{option.name}</b><small>{label}</small></span>
        </button>;
      })}
      {!filtered.length && <div className="skylark-asset-empty"><b>暂无{roleNames[category]}数据</b><span>可先去资产库补齐，或切换到全集查看。</span><AppButton onClick={onOpenAssets}>新增</AppButton></div>}
    </div>
  </aside>;
}

const promptTools = [
  { id: "duration", label: "添加时间", hint: "插入片段时长标签", insert: "【时长：10秒】" },
  { id: "camera", label: "运镜", hint: "打开运镜库挑选镜头运动", insert: "" },
  { id: "link", label: "片段链接", hint: "与前后片段衔接", insert: "【衔接：硬切】" },
  { id: "frames", label: "首尾帧参考", hint: "强调首尾帧约束", insert: "【首尾帧参考】" },
] as const;

const cameraMoves = [
  { id: "pan-left", category: "基础控制", label: "镜头左摇", hint: "横向展示空间", insert: "【运镜：镜头左摇，横向展示空间】" },
  { id: "tilt-up", category: "基础控制", label: "镜头上摇", hint: "抬升视线、显露高度", insert: "【运镜：镜头上摇，抬升视线】" },
  { id: "tilt-down", category: "基础控制", label: "镜头下摇", hint: "俯视落地、收束情绪", insert: "【运镜：镜头下摇，收束视线】" },
  { id: "push-in", category: "基础控制", label: "缓慢推进", hint: "靠近主体、加强压迫", insert: "【运镜：缓慢推进，靠近主体】" },
  { id: "pull-out", category: "基础控制", label: "缓慢拉远", hint: "交代环境、拉开距离", insert: "【运镜：缓慢拉远，交代环境】" },
  { id: "follow", category: "人物跟拍", label: "侧向跟拍", hint: "跟随角色行走", insert: "【运镜：侧向跟拍角色】" },
  { id: "orbit", category: "人物跟拍", label: "环绕半圈", hint: "展示人物立体感", insert: "【运镜：环绕角色半圈】" },
  { id: "whip", category: "摇示转场", label: "甩镜头转场", hint: "快速切到下一动作", insert: "【运镜：甩镜头转入下一拍】" },
  { id: "handheld", category: "情绪强化", label: "轻微手持晃动", hint: "紧张不安感", insert: "【运镜：轻微手持晃动，强化紧张】" },
  { id: "crane", category: "空间赋拍", label: "升起俯瞰", hint: "从人到空间拉开", insert: "【运镜：升起俯瞰，从人到空间】" },
] as const;

const cameraCategories = ["全部", "基础控制", "人物跟拍", "摇示转场", "情绪强化", "空间赋拍"] as const;

export function CameraMoveLibrary({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (insert: string) => void }) {
  const [category, setCategory] = useState<(typeof cameraCategories)[number]>("全部");
  const [selectedId, setSelectedId] = useState<string>(cameraMoves[1]?.id ?? cameraMoves[0].id);
  if (!open) return null;
  const filtered = category === "全部" ? cameraMoves : cameraMoves.filter((item) => item.category === category);
  const selected = cameraMoves.find((item) => item.id === selectedId) ?? filtered[0];
  return <div className="skylark-camera-modal" role="dialog" aria-modal="true" aria-label="运镜库" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="skylark-camera-panel">
      <header><h3>运镜库</h3><button type="button" className="skylark-link-btn" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="skylark-camera-tabs">
        {cameraCategories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="skylark-camera-grid">
        {filtered.map((item) => (
          <button type="button" key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} onDoubleClick={() => onPick(item.insert)}>
            <div className="skylark-camera-thumb">{item.label.slice(0, 2)}</div>
            <b>{item.label}</b>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
      <footer>
        <button type="button" className="skylark-ghost-btn" onClick={onClose}>取消</button>
        <button type="button" className="skylark-primary-btn" disabled={!selected} onClick={() => selected && onPick(selected.insert)}>插入运镜</button>
      </footer>
    </section>
  </div>;
}

export function SegmentPromptCanvas({
  segmentTitle,
  segmentSequence,
  prompt,
  saveState,
  busy,
  generating,
  generateLabel,
  generateDisabled,
  options,
  selectedKeys,
  advancedOpen,
  advanced,
  onChange,
  onSave,
  onCancel,
  onGenerate,
  onToggleReference,
  onToggleAdvanced,
}: {
  segmentTitle: string;
  segmentSequence: number;
  prompt: string;
  saveState: string;
  busy: boolean;
  generating: boolean;
  generateLabel: string;
  generateDisabled: boolean;
  options: SegmentReferenceOption[];
  selectedKeys: string[];
  advancedOpen: boolean;
  advanced: ReactNode;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onGenerate: () => void;
  onToggleReference: (key: string) => void;
  onToggleAdvanced: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionTab, setMentionTab] = useState<"assets" | "tools">("assets");
  const [mentionQuery, setMentionQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);

  const syncMention = (value: string, nextCursor: number) => {
    const before = value.slice(0, nextCursor);
    const match = before.match(/@([^@\s]*)$/);
    if (!match) {
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    setMentionOpen(true);
    setMentionQuery(match[1] ?? "");
    setMentionTab("assets");
  };

  const insertText = (text: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? cursor;
    const end = el?.selectionEnd ?? cursor;
    const before = prompt.slice(0, start);
    const after = prompt.slice(end);
    const atMatch = before.match(/@([^@\s]*)$/);
    const replaceFrom = atMatch ? before.length - atMatch[0].length : start;
    const next = `${prompt.slice(0, replaceFrom)}${text}${after}`;
    onChange(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const pos = replaceFrom + text.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const filteredAssets = options.filter((option) => {
    if (!mentionQuery.trim()) return true;
    return option.name.includes(mentionQuery) || option.description.includes(mentionQuery);
  }).slice(0, 24);

  return <main className="skylark-prompt-canvas">
    <header className="skylark-prompt-header">
      <div><h2>片段 {String(segmentSequence).padStart(2, "0")}</h2><p>{segmentTitle}</p></div>
      <small>输入 @ 引用资产及工具 · {saveState}</small>
    </header>
    <div className="skylark-prompt-stage">
      <textarea
        ref={textareaRef}
        aria-label="片段生成指令"
        value={prompt}
        disabled={busy || generating}
        placeholder="描述这一段要发生的事，输入 @ 引用角色、场景、道具…"
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart);
          syncMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => {
          setCursor(event.currentTarget.selectionStart);
          syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onKeyUp={(event) => {
          setCursor(event.currentTarget.selectionStart);
          syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
      />
      {mentionOpen && <div className="skylark-mention-menu" role="listbox" aria-label="引用资产及工具">
        <div className="skylark-mention-tabs">
          <button type="button" className={mentionTab === "assets" ? "active" : ""} onClick={() => setMentionTab("assets")}>资产</button>
          <button type="button" className={mentionTab === "tools" ? "active" : ""} onClick={() => setMentionTab("tools")}>小工具</button>
        </div>
        {mentionTab === "assets" ? (
          <div className="skylark-mention-list">
            {filteredAssets.map((option) => (
              <button type="button" key={option.key} onClick={() => {
                if (!selectedKeys.includes(option.key)) onToggleReference(option.key);
                insertText(`@${option.name} `);
              }}>
                <i style={option.imageUrl ? { backgroundImage: `url(${option.imageUrl})` } : undefined} />
                <span><b>{option.name}</b><small>{roleNames[option.role]} · {option.ready ? "可引用" : "未就绪"}</small></span>
              </button>
            ))}
            {!filteredAssets.length && <p>暂无可引用内容</p>}
          </div>
        ) : (
          <div className="skylark-mention-list">
            {promptTools.map((tool) => (
              <button type="button" key={tool.id} onClick={() => {
                if (tool.id === "camera") {
                  setMentionOpen(false);
                  setCameraOpen(true);
                  return;
                }
                insertText(`${tool.insert} `);
              }}>
                <span><b>{tool.label}</b><small>{tool.hint}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>}
      <CameraMoveLibrary open={cameraOpen} onClose={() => setCameraOpen(false)} onPick={(insert) => { insertText(`${insert} `); setCameraOpen(false); }} />
      <footer className="skylark-prompt-actions">
        <button type="button" className="skylark-link-btn" onClick={onToggleAdvanced}>{advancedOpen ? "收起高级" : "编辑"}</button>
        <button type="button" className="skylark-ghost-btn" disabled={busy || generating} onClick={onCancel}>取消</button>
        <button type="button" className="skylark-ghost-btn" disabled={busy || generating || !prompt.trim()} onClick={onSave}>保存</button>
        <button type="button" className="skylark-primary-btn" disabled={generateDisabled} onClick={onGenerate}>{generateLabel}</button>
      </footer>
    </div>
    {advancedOpen && <div className="skylark-advanced-drawer">{advanced}</div>}
  </main>;
}

export function SegmentPhonePreview({
  aspectRatio,
  videoUrl,
  frameUrl,
  generating,
  generateDisabled,
  statusLabel,
  versionLabel,
  frameReadyCount = 0,
  frameTotal = 0,
  awaitingFrameConfirm = false,
  onGenerate,
}: {
  aspectRatio: string;
  videoUrl: string | null;
  frameUrl: string | null;
  generating: boolean;
  generateDisabled: boolean;
  statusLabel: string;
  versionLabel: string;
  frameReadyCount?: number;
  frameTotal?: number;
  awaitingFrameConfirm?: boolean;
  onGenerate: () => void;
}) {
  const vertical = aspectRatio === "9:16" || aspectRatio === "3:4";
  const hasVideo = Boolean(videoUrl);
  const hasFrame = Boolean(frameUrl);
  const emptyHint = generating
    ? "生成过程中的画面会短暂出现在这里；首帧会留在下方检查条"
    : awaitingFrameConfirm
      ? `下方 ${frameReadyCount}/${frameTotal || frameReadyCount} 个首帧已齐，点中间「确认首帧并生成视频」`
      : frameReadyCount > 0
        ? `已有 ${frameReadyCount} 个首帧在下方；成片还要再确认后生成`
        : "右侧只显示成片。请先点中间「立即生成」出首帧，首帧会出现在下方";
  return <aside className="skylark-phone-preview" aria-label="片段成片预览">
    <div className={`skylark-phone-frame ${vertical ? "vertical" : "horizontal"} ${hasVideo ? "has-video" : hasFrame ? "has-frame" : "empty"}`}>
      {hasVideo ? <video controls src={videoUrl!} /> : hasFrame ? <div className="skylark-phone-still" style={{ backgroundImage: `url(${frameUrl})` }} /> : (
        <button type="button" className="skylark-phone-empty" disabled={generateDisabled} onClick={onGenerate}>
          <span className="skylark-phone-play" aria-hidden>▶</span>
          <b>{generating ? "正在生成…" : "还没有成片"}</b>
          <small>{emptyHint}</small>
        </button>
      )}
      <em>{hasVideo ? versionLabel : hasFrame ? `${versionLabel} · 首帧预览` : versionLabel}</em>
    </div>
    {hasVideo ? <p className="skylark-phone-hint">{statusLabel}</p> : hasFrame ? <p className="skylark-phone-hint">这是当前分镜首帧，不是成片；成片要确认首帧后再生成</p> : null}
  </aside>;
}

export function SegmentFrameReviewStrip({
  open,
  shots,
  selectedShotId,
  frameUrl,
  referenceLabels,
  awaitingConfirm,
  busy,
  redoCurrentDisabled,
  redoAllDisabled,
  onToggle,
  onSelect,
  onRedoCurrent,
  onRedoAll,
}: {
  open: boolean;
  shots: ProjectShot[];
  selectedShotId: string;
  frameUrl: (shot: ProjectShot) => string | null;
  referenceLabels?: (shot: ProjectShot) => string[];
  awaitingConfirm: boolean;
  busy: boolean;
  redoCurrentDisabled: boolean;
  redoAllDisabled: boolean;
  onToggle: () => void;
  onSelect: (shotId: string) => void;
  onRedoCurrent: () => void;
  onRedoAll: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const readyCount = shots.filter((shot) => Boolean(shot.firstFrameAssetId) || Boolean(frameUrl(shot))).length;
  const selectedShotForFrame = shots.find((shot) => shot.id === selectedShotId) ?? null;
  const selectedHasFrame = Boolean(selectedShotForFrame?.firstFrameAssetId) || Boolean(selectedShotForFrame && frameUrl(selectedShotForFrame));
  return <section className={`skylark-frame-review ${open || awaitingConfirm ? "open" : ""}`}>
    <div className="skylark-frame-review-bar">
      <button type="button" className="skylark-frame-review-toggle" onClick={onToggle}>
        <span>{awaitingConfirm ? "首帧已齐，确认后再出视频" : readyCount ? `本片段分镜首帧 · 已生成 ${readyCount}/${shots.length}` : "本片段分镜首帧 · 每镜参考不同，点卡片看左侧"}</span>
        <b>{readyCount}/{shots.length}</b>
      </button>
      {(open || awaitingConfirm) ? <div className="skylark-frame-review-actions">
        {selectedHasFrame ? <button type="button" className="skylark-ghost-btn" disabled={busy || redoCurrentDisabled} onClick={onRedoCurrent}>重做当前</button> : null}
        <button type="button" className="skylark-ghost-btn" disabled={busy || redoAllDisabled} onClick={onRedoAll}>{readyCount ? "全部重做" : "生成全部首帧"}</button>
      </div> : null}
    </div>
    {(open || awaitingConfirm) && <div className="skylark-frame-review-list">
      {shots.map((shot, index) => {
        const imageUrl = frameUrl(shot);
        const ready = Boolean(imageUrl) || Boolean(shot.firstFrameAssetId);
        const labels = referenceLabels?.(shot) ?? [];
        return <button
          type="button"
          key={shot.id}
          className={shot.id === selectedShotId ? "active" : ""}
          onClick={() => {
            onSelect(shot.id);
            if (imageUrl) setPreviewUrl(imageUrl);
          }}
          title={labels.length ? `本镜参考：${labels.join("、")}` : (imageUrl ? "点击查看大图" : "尚未生成首帧")}
        >
          <div className={ready && imageUrl ? "" : "missing"} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {!imageUrl && <i>未生成</i>}
          </div>
          <p>{shot.title}</p>
          <small className="skylark-frame-ref-labels">{labels.length ? labels.join(" · ") : "无角色参考"}</small>
        </button>;
      })}
    </div>}
    {previewUrl ? <div className="skylark-frame-lightbox" role="dialog" aria-modal="true" aria-label="首帧大图" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewUrl(null); }}>
      <figure>
        <img src={previewUrl} alt="分镜首帧大图" />
        <figcaption>
          <span>分镜首帧预览</span>
          <button type="button" onClick={() => setPreviewUrl(null)}>关闭</button>
        </figcaption>
      </figure>
    </div> : null}
  </section>;
}

export function SegmentDirectorPrompt({ prompt, productionMode, promptSource, saveState, busy, onChange, onSave, onReset }: {
  prompt: string;
  productionMode: "unified_segment" | "stitched_shots" | null;
  promptSource: "manual" | "automatic";
  saveState: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return <details className="segment-director-prompt segment-advanced-panel" open>
    <summary><div><span>整段生成指令（高级）</span><b>{productionMode === "unified_segment" ? "一次生成整段" : productionMode === "stitched_shots" ? "逐镜后合成" : "准备中"}</b></div><small>{promptSource === "manual" ? "已使用人工调整版；生成与重做都会使用这里的内容" : "由片段内分镜、对白自动合成，可直接调整"}</small></summary>
    {prompt ? <>
      <textarea aria-label="整段生成指令备份" value={prompt} onChange={(event) => onChange(event.target.value)} />
      <div className="segment-director-actions"><span>{saveState}</span><button type="button" onClick={() => void navigator.clipboard?.writeText(prompt)}>复制</button>{promptSource === "manual" && <button type="button" disabled={busy} onClick={onReset}>恢复自动指令</button>}<AppButton primary disabled={busy || !prompt.trim()} onClick={onSave}>{busy ? "正在保存…" : "保存片段指令"}</AppButton></div>
    </> : <div className="segment-reference-empty"><b>正在建立片段指令</b><span>读取分镜、对白后会自动出现。</span></div>}
  </details>;
}

export function SegmentShotProductionPanel({
  shot,
  prompt,
  saveState,
  videoCapability,
  videoCapabilitySaveState,
  capabilityConfigured,
  environmentPresetName,
  lastFrameReady,
  disabled,
  segmentShotCount,
  onPromptChange,
  onVideoCapabilityChange,
  onApplyToAllShots,
  onGenerateLastFrame,
  onOpenSettings,
}: {
  shot: ProjectShot;
  prompt: string;
  saveState: string;
  videoCapability: ShotVideoCapability;
  videoCapabilitySaveState: string;
  capabilityConfigured: boolean;
  environmentPresetName: string | null;
  lastFrameReady: boolean;
  disabled: boolean;
  segmentShotCount: number;
  onPromptChange: (value: string) => void;
  onVideoCapabilityChange: (value: ShotVideoCapability) => void;
  onApplyToAllShots: () => void;
  onGenerateLastFrame: () => void;
  onOpenSettings: () => void;
}) {
  const selectedOption = shotVideoCapabilityOptions.find((option) => option.key === videoCapability) ?? shotVideoCapabilityOptions[0];
  return <section className="segment-shot-production-panel nested">
    <header className="segment-shot-production-heading">
      <div><span>当前选中的分镜</span><b>分镜 {shot.sequence} · {shot.title}</b></div>
      <small>{Math.round(shot.durationMs / 100) / 10} 秒 · {prompt.length} 字 · {saveState}</small>
    </header>
    <div className="segment-shot-production-grid">
      <label className="segment-video-mode-field">
        <span>视频生成方式</span>
        <select value={videoCapability} disabled={disabled} onChange={(event) => onVideoCapabilityChange(event.target.value as ShotVideoCapability)}>
          {shotVideoCapabilityOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        <em>{selectedOption.hint}</em>
        {!capabilityConfigured && <p className="segment-capability-gap">该方式尚未在设置里接线并通过测试。<button type="button" onClick={onOpenSettings}>打开设置</button></p>}
      </label>
      <label className="segment-shot-prompt-field">
        <span>分镜导演指令</span>
        <textarea value={prompt} disabled={disabled} onChange={(event) => onPromptChange(event.target.value)} />
      </label>
    </div>
    <footer className="segment-shot-production-meta">
      <span>{selectedOption.label} · {videoCapabilitySaveState}</span>
      <span>{environmentPresetName ? `声音场：${environmentPresetName}` : "尚未继承场景声音场"}</span>
      {segmentShotCount > 1 && <button type="button" disabled={disabled} onClick={onApplyToAllShots}>应用到本片段 {segmentShotCount} 个分镜</button>}
    </footer>
    {videoCapability === "first_last_frame_video" ? <div className="last-frame-tools"><div><b>{lastFrameReady ? "尾帧已就绪" : "首尾帧模式还需要尾帧"}</b><span>{lastFrameReady ? "生成视频时会同时使用首帧与尾帧控制动作" : "请先生成尾帧，再提交片段生成"}</span></div><AppButton disabled={disabled} onClick={onGenerateLastFrame}>{lastFrameReady ? "重做尾帧" : "生成尾帧"}</AppButton></div> : null}
  </section>;
}

export function SegmentReferenceTray({ references, mode, onEdit }: { references: SegmentReferenceView[]; mode: "automatic" | "manual"; onEdit: () => void }) {
  return <section className="segment-reference-tray">
    <div className="segment-section-title"><div><span>本片段会带上的参考图</span><b>{references.length} 项 · {mode === "manual" ? "已手动调整" : "按分镜自动带上"}</b></div><div className="segment-reference-title-actions"><small>生成首帧时每角色只喂主图一张，不会整包塞入三视图</small><button type="button" onClick={onEdit}>调整参考</button></div></div>
    <div className="segment-reference-list">
      {references.map((reference) => <article key={reference.key} className={reference.missing ? "missing" : "ready"}>
        <i style={reference.imageUrl ? { backgroundImage: `url(${reference.imageUrl})` } : undefined}>{!reference.imageUrl && (reference.missing ? "!" : "◇")}</i>
        <div><span>{roleNames[reference.role] ?? reference.role}</span><b>{reference.name}</b><small>分镜 {reference.shotSequences.join("、") || "—"}</small></div>
      </article>)}
      {!references.length && <div className="segment-reference-empty"><b>还没有角色/场景引用</b><span>请先回资产库确认角色、场景和道具，再回来生成片段。</span></div>}
    </div>
  </section>;
}

export function SegmentReferencePicker({ open, data, selectedKeys, busy, message, onClose, onToggle, onSave, onReset }: {
  open: boolean;
  data: SegmentReferenceData | null;
  selectedKeys: string[];
  busy: boolean;
  message: string;
  onClose: () => void;
  onToggle: (key: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  if (!open) return null;
  return <div className="segment-reference-modal" role="dialog" aria-modal="true" aria-label="调整片段参考素材" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="segment-reference-picker">
      <header><div><span>片段参考素材</span><h3>选择这段视频真正使用的角色、场景和道具</h3><p>最多选择 24 项。保存后会用于整段生成、逐镜首帧和单镜修复；参考变化时，旧结果保留在历史版本中，但当前片段需要重新生成。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      {!data ? <div className="segment-reference-picker-loading">正在读取项目资产…</div> : <div className="segment-reference-groups">{(["character", "scene", "prop"] as const).map((role) => {
        const options = data.options.filter((option) => option.role === role);
        return <section key={role}><div><b>{roleNames[role]}</b><span>{selectedKeys.filter((key) => options.some((option) => option.key === key)).length} / {options.length}</span></div>
          <div className="segment-reference-options">{options.map((option) => {
            const selected = selectedKeys.includes(option.key);
            return <label key={option.key} className={`${selected ? "selected" : ""} ${option.ready ? "ready" : "missing"}`}>
              <input type="checkbox" checked={selected} disabled={busy || (!selected && selectedKeys.length >= 24)} onChange={() => onToggle(option.key)} />
              <i style={option.imageUrl ? { backgroundImage: `url(${option.imageUrl})` } : undefined}>{!option.imageUrl && "◇"}</i>
              <span><b>{option.name}</b><small>{option.description}</small><em>{option.ready ? "标准图已就绪" : "标准图尚未就绪"}</em></span>
            </label>;
          })}{!options.length && <p>项目中还没有可用的{roleNames[role]}资产。</p>}</div>
        </section>;
      })}</div>}
      <footer><span>{message || `${selectedKeys.length} / 24 项参考素材`}</span><div>{data?.mode === "manual" && <button type="button" disabled={busy} onClick={onReset}>恢复按分镜自动引用</button>}<button type="button" disabled={busy} onClick={onClose}>取消</button><AppButton primary disabled={busy || !data} onClick={onSave}>{busy ? "正在保存…" : "保存并应用"}</AppButton></div></footer>
    </section>
  </div>;
}

export function SegmentShotRail({ shots, selectedShotId, referenceCountByShot, frameUrl, onSelect, actions }: {
  shots: ProjectShot[];
  selectedShotId: string;
  referenceCountByShot: Map<string, number>;
  frameUrl: (shot: ProjectShot) => string | null;
  onSelect: (shotId: string) => void;
  actions?: ReactNode;
}) {
  return <section className="segment-shot-rail">
    <div className="segment-section-title"><div><span>本片段内的分镜首帧</span><b>{shots.length} 个连续分镜</b></div>{actions ?? <small>首帧全部就绪后需你确认，才会继续生成视频</small>}</div>
    <div className="segment-shot-list">{shots.map((shot, index) => {
      const imageUrl = frameUrl(shot);
      return <button type="button" key={shot.id} className={shot.id === selectedShotId ? "active" : ""} onClick={() => onSelect(shot.id)}>
        <div className={imageUrl ? "" : "missing"} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{!imageUrl && <i>未生成</i>}</div>
        <p><b>{shot.title}</b><span>{Math.round(shot.durationMs / 100) / 10}s · {referenceCountByShot.get(shot.id) ?? 0} 项引用</span></p>
        <em>{shot.videoAssetId ? "已生成" : shot.firstFrameAssetId ? "首帧就绪" : "未生成"}</em>
      </button>;
    })}</div>
  </section>;
}

function segmentState(segment: ProjectSegment, segmentShots: ProjectShot[]) {
  const readyShots = segmentShots.filter((shot) => shot.videoAssetId).length;
  if (segment.videoAssetId) return { className: "ready", label: `V${segment.currentVersionNumber}`, progress: 100 };
  if (["preparing", "generating", "generating_shots", "composing", "processing_sound", "mixing", "lip_syncing"].includes(segment.status)) {
    return { className: "running", label: "生成中", progress: segmentShots.length ? Math.max(8, Math.round((readyShots / segmentShots.length) * 82)) : 8 };
  }
  if (segment.status.includes("fail") || segment.status.includes("error")) return { className: "failed", label: "失败", progress: segmentShots.length ? Math.round((readyShots / segmentShots.length) * 82) : 0 };
  if (readyShots) return { className: "partial", label: "部分完成", progress: segmentShots.length ? Math.round((readyShots / segmentShots.length) * 82) : 0 };
  const frames = segmentShots.filter((shot) => shot.firstFrameAssetId).length;
  if (frames) return { className: "partial", label: "首帧就绪", progress: Math.round((frames / Math.max(1, segmentShots.length)) * 50) };
  return { className: "draft", label: "未生成", progress: 0 };
}

export function SegmentEpisodeRail({ segments, shots, versions, activeSegmentId, onSelect }: {
  segments: ProjectSegment[];
  shots: ProjectShot[];
  versions: SegmentVersion[];
  activeSegmentId: string | null;
  onSelect: (segmentId: string) => void;
}) {
  return <div className="skylark-segment-rail" aria-label="本集片段">
    <div className="skylark-segment-rail-tabs"><span>本集片段</span><small>点选切换要生成的片段；一条片段里可有多个分镜</small></div>
    <div className="skylark-segment-rail-track">
      {segments.map((segment) => {
        const segmentShots = shots.filter((shot) => shot.segmentId === segment.id);
        const state = segmentState(segment, segmentShots);
        return <button type="button" key={segment.id} className={`${activeSegmentId === segment.id ? "active" : ""} ${state.className}`} onClick={() => onSelect(segment.id)}>
          <div className="skylark-segment-thumb">{segment.videoAssetId ? <span className="play">▶</span> : <span className="clap">▣</span>}</div>
          <b>片段 {String(segment.sequence).padStart(2, "0")} · {Math.round(segment.durationMs / 100) / 10}s</b>
          <small>{state.label}{versions.some((version) => version.segmentId === segment.id) ? " · 有历史" : ""}</small>
        </button>;
      })}
    </div>
  </div>;
}

function versionStatus(version: SegmentVersion) {
  if (version.status === "approved") return "审片通过";
  if (version.status === "review_failed") return "审片未通过";
  if (version.status === "review_required") return "等待审片";
  return "已生成";
}

export function SegmentVersionGallery({ versions, assets, currentVersionNumber, previewAssetId, selectingVersionId, busy, onPreview, onSelect }: {
  versions: SegmentVersion[];
  assets: ProjectAsset[];
  currentVersionNumber: number;
  previewAssetId: string | null;
  selectingVersionId: string | null;
  busy: boolean;
  onPreview: (assetId: string) => void;
  onSelect: (version: SegmentVersion) => void;
}) {
  const available = versions.filter((version): version is SegmentVersion & { resultAssetId: string } => Boolean(version.resultAssetId));
  if (!available.length) return null;
  return <section className="segment-version-gallery">
    <div className="segment-section-title"><div><span>片段候选版本</span><b>{available.length} 个结果</b></div><small>预览不会改变整集合成；只有“采用此版本”会更新当前版本</small></div>
    <div className="segment-version-list">{available.map((version) => {
      const asset = assets.find((item) => item.id === version.resultAssetId);
      const current = version.versionNumber === currentVersionNumber;
      const previewing = version.resultAssetId === previewAssetId || (!previewAssetId && current);
      return <article key={version.id} className={`${current ? "current" : ""} ${previewing ? "previewing" : ""}`}>
        <button type="button" className="version-preview" onClick={() => onPreview(version.resultAssetId)}>
          {asset?.thumbnailUrl ? <video muted playsInline preload="metadata" src={asset.thumbnailUrl} /> : <div>视频文件不可用</div>}
          <span>V{version.versionNumber}</span><i>{current ? "当前采用" : previewing ? "正在预览" : "预览"}</i>
        </button>
        <div className="version-meta"><b>{version.productionMode === "stitched_shots" ? "逐分镜合成" : version.productionMode === "visual_plus_audio_mux" ? "画面＋声音合成" : "整段生成"}</b><span>{versionStatus(version)} · {formatVersionTime(version.createdAt)}</span></div>
        <AppButton disabled={busy || current || selectingVersionId === version.id} onClick={() => onSelect(version)}>{current ? "已用于整集合成" : busy ? "片段正在生成" : selectingVersionId === version.id ? "正在采用…" : "采用此版本"}</AppButton>
      </article>;
    })}</div>
  </section>;
}
