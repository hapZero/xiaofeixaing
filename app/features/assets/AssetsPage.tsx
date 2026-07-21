"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import { CanvasOverlay } from "../canvas/CanvasWorkspace";
import { ProjectTop } from "../project/ProjectTop";
import { roleImages, sceneImages } from "../studio/media";
import type { AudioPreset, ProjectAsset, ProjectCharacter, ProjectEpisode, ProjectSummary, View } from "../studio/types";

type AssetTab = "角色" | "场景" | "道具" | "素材";
type ProjectAssetsResponse = {
  project: ProjectSummary;
  episodes: ProjectEpisode[];
  assets: ProjectAsset[];
  characters: ProjectCharacter[];
  audioPresets: AudioPreset[];
};

function sceneAssetId(preset: AudioPreset): string | null {
  try {
    const config = JSON.parse(preset.configJson) as { sceneAssetId?: unknown };
    return typeof config.sceneAssetId === "string" ? config.sceneAssetId : null;
  } catch {
    return null;
  }
}

export function AssetsPage({ onNavigate, project: initialProject }: { onNavigate: (view: View) => void; project: ProjectSummary | null }) {
  const [tab, setTab] = useState<AssetTab>("角色");
  const [detail, setDetail] = useState<ProjectAssetsResponse | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<ProjectCharacter | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<AudioPreset | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialProject));
  const [extracting, setExtracting] = useState(false);
  const [preparingShots, setPreparingShots] = useState(false);
  const [error, setError] = useState("");

  const projectId = initialProject?.id ?? null;
  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("项目资产加载失败");
      setDetail(await response.json() as ProjectAssetsResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目资产加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("项目资产加载失败");
        return response.json() as Promise<ProjectAssetsResponse>;
      })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "项目资产加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const characterAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "character") ?? [], [detail]);
  const sceneAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "scene") ?? [], [detail]);
  const propAssets = useMemo(() => detail?.assets.filter((asset) => asset.assetType === "prop") ?? [], [detail]);
  const materialAssets = useMemo(() => detail?.assets.filter((asset) => !["character", "scene", "prop"].includes(asset.assetType)) ?? [], [detail]);
  const counts: Record<AssetTab, number> = { 角色: detail?.characters.length ?? 0, 场景: sceneAssets.length, 道具: propAssets.length, 素材: materialAssets.length };
  const configured = (detail?.characters.filter((character) => character.voiceLocked).length ?? 0) + (detail?.audioPresets.filter((preset) => preset.locked).length ?? 0);
  const configurable = (detail?.characters.length ?? 0) + (detail?.audioPresets.length ?? 0);

  const extractAgain = async () => {
    if (!projectId) return;
    setExtracting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/extract-assets`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "资产提取失败");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产提取失败");
    } finally {
      setExtracting(false);
    }
  };

  const confirmAssets = async () => {
    if (!projectId) return;
    if (configurable > 0 && configured < configurable) {
      setError("请先锁定全部角色音色和场景环境音，避免分镜之间声音漂移");
      return;
    }
    setPreparingShots(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/storyboards`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "分镜脚本生成失败");
      }
      onNavigate("videos");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜脚本生成失败");
    } finally {
      setPreparingShots(false);
    }
  };

  if (!initialProject) {
    return <StudioShell view="assets" onNavigate={onNavigate}><div className="missing-project"><b>还没有选择短剧项目</b><p>请先打开项目并确认剧本。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></StudioShell>;
  }

  return (
    <StudioShell view="assets" onNavigate={onNavigate}>
      <ProjectTop step={2} onNavigate={onNavigate} title={detail?.project.title ?? initialProject.title} stylePreset={detail?.project.stylePreset ?? initialProject.stylePreset} aspectRatio={detail?.project.aspectRatio ?? initialProject.aspectRatio} saveState="项目级资产" />
      <div className="assets-page">
        <div className="assets-heading">
          <div><p className="eyebrow">全剧资产</p><h2>确认角色与场景的一致性</h2><p>角色音色和场景声音场会被所有分镜引用，锁定后不会在镜头之间随机变化。</p></div>
          <div className="assets-heading-actions"><AppButton onClick={extractAgain} disabled={extracting}>{extracting ? "正在提取…" : "重新提取资产"}</AppButton><AppButton onClick={() => setCanvasOpen(true)}>⌘ 去画布编辑</AppButton></div>
        </div>
        <div className="asset-tabs">
          {(["角色", "场景", "道具", "素材"] as AssetTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<span>{counts[item]}</span></button>)}
        </div>
        <div className="asset-toolbar"><div><button className="active">全部</button><button>待配置 {Math.max(0, configurable - configured)}</button><button>已锁定 {configured}</button></div><div><button onClick={() => void load()}>↻ 刷新</button></div></div>
        {loading ? <div className="project-empty">正在读取项目资产…</div> : (
          <>
            {tab === "角色" && (detail?.characters.length ? <div className="asset-grid role-grid">
              {detail.characters.map((character, index) => {
                const linkedAsset = characterAssets.find((asset) => asset.id === character.assetId);
                return (
                  <button className="asset-card" key={character.id} onClick={() => setSelectedCharacter(character)}>
                    <div className="asset-image portrait" style={{ backgroundImage: `url(${linkedAsset?.thumbnailUrl ?? roleImages[index % roleImages.length]})` }}>
                      <span className={character.voiceLocked ? "confirmed" : "review"}>{character.voiceLocked ? "音色已锁定" : "待配置音色"}</span>
                      {index === 0 && <em>主角</em>}<i className="voice-badge">♬</i>
                    </div>
                    <div className="asset-card-info"><div><h3>{character.canonicalName}</h3><p>{character.voiceDescription || "点击设置固定角色音色"}</p></div><b>···</b></div>
                  </button>
                );
              })}
            </div> : <AssetEmpty title="没有识别到角色" description="请在剧本中使用“人物：林微、陈屹”或角色对白格式，再重新提取。" onExtract={extractAgain} />)}
            {tab === "场景" && (sceneAssets.length ? <div className="asset-grid scene-grid">
              {sceneAssets.map((asset, index) => {
                const preset = detail?.audioPresets.find((item) => sceneAssetId(item) === asset.id) ?? null;
                return <button className="asset-card" key={asset.id} onClick={() => preset && setSelectedPreset(preset)}><div className="asset-image landscape" style={{ backgroundImage: `url(${asset.thumbnailUrl ?? sceneImages[index % sceneImages.length]})` }}><span className={preset?.locked ? "confirmed" : "review"}>{preset?.locked ? "环境音已锁定" : "待配置声音场"}</span></div><div className="asset-card-info"><div><h3>{asset.name}</h3><p>{preset?.description || "点击设置环境底噪与空间混响"}</p></div><b>···</b></div></button>;
              })}
            </div> : <AssetEmpty title="没有识别到场景" description="请在剧本中使用“场景：旧教室”或“旧教室 · 日 · 内”的格式，再重新提取。" onExtract={extractAgain} />)}
            {tab === "道具" && (propAssets.length ? <div className="asset-grid scene-grid">{propAssets.map((asset) => <div className="empty-assets" key={asset.id}><div className="prop-visual">物</div><h3>{asset.name}</h3><p>从剧本提取 · 待补充标准图</p></div>)}</div> : <AssetEmpty title="没有识别到关键道具" description="在剧本中添加“道具：旧信、钥匙”等标记即可提取。" onExtract={extractAgain} />)}
            {tab === "素材" && <AssetEmpty title="还没有项目素材" description="后续上传或生成的图片、视频和音频会统一保存在这里。" />}
          </>
        )}
        {error && <p className="project-form-error asset-error" role="alert">{error}</p>}
        <div className="asset-page-footer"><AppButton onClick={() => onNavigate("script")}>← 上一步</AppButton><div><span>{configurable ? `${configurable} 项声音一致性设置，已锁定 ${configured} 项` : "请先从剧本提取角色与场景"}</span><AppButton primary disabled={!detail || !configurable || preparingShots} onClick={confirmAssets}>{preparingShots ? "正在拆分分镜…" : "确认资产，生成分镜 →"}</AppButton></div></div>
      </div>
      {selectedCharacter && projectId && <VoiceModal projectId={projectId} character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onSaved={(character) => { setDetail((current) => current ? { ...current, characters: current.characters.map((item) => item.id === character.id ? character : item) } : current); setSelectedCharacter(null); }} />}
      {selectedPreset && projectId && <EnvironmentModal projectId={projectId} preset={selectedPreset} onClose={() => setSelectedPreset(null)} onSaved={(preset) => { setDetail((current) => current ? { ...current, audioPresets: current.audioPresets.map((item) => item.id === preset.id ? preset : item) } : current); setSelectedPreset(null); }} />}
      {canvasOpen && <CanvasOverlay projectId={projectId} title={initialProject.title} onClose={() => setCanvasOpen(false)} onContinue={() => { setCanvasOpen(false); void confirmAssets(); }} />}
    </StudioShell>
  );
}

function AssetEmpty({ title, description, onExtract }: { title: string; description: string; onExtract?: () => void }) {
  return <div className="asset-empty-state"><div>◇</div><h3>{title}</h3><p>{description}</p>{onExtract && <AppButton onClick={onExtract}>重新提取资产</AppButton>}</div>;
}

function VoiceModal({ projectId, character, onClose, onSaved }: { projectId: string; character: ProjectCharacter; onClose: () => void; onSaved: (character: ProjectCharacter) => void }) {
  const [voiceMode, setVoiceMode] = useState<"文本音色" | "上传音频" | "AI生成" | "已有音频">("文本音色");
  const [name, setName] = useState(character.canonicalName);
  const [description, setDescription] = useState(character.voiceDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!description.trim()) return setError("请先描述角色音色，或选择一段参考声音");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/characters/${character.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalName: name, voiceDescription: description, voiceLocked: true }) });
      if (!response.ok) throw new Error("角色音色保存失败");
      const data = await response.json() as { character: ProjectCharacter };
      onSaved(data.character);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "角色音色保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}><div className="voice-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">角色详情</p><h2>{character.canonicalName} · 固定音色</h2></div><button onClick={onClose}>×</button></div>
      <div className="voice-modal-body"><div className="role-preview" style={{ backgroundImage: `url(${roleImages[(character.canonicalName.codePointAt(0) ?? 0) % roleImages.length]})` }}><span>角色标准图</span></div><div className="role-form">
        <label>角色名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="voice-section-title"><div><h3>固定角色音色</h3><p>所有分镜只引用这个角色音色 ID，不在分镜中重新随机生成</p></div><span className={character.voiceLocked ? "saved-state" : "pending-state"}>{character.voiceLocked ? "✓ 已锁定" : "待锁定"}</span></div>
        <div className="voice-mode-tabs">{(["文本音色", "上传音频", "AI生成", "已有音频"] as const).map((item) => <button key={item} className={voiceMode === item ? "active" : ""} onClick={() => setVoiceMode(item)}>{item}</button>)}</div>
        {voiceMode === "文本音色" ? <textarea className="voice-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：青年女声，音调偏中高，清澈克制，语速偏慢…" /> : <div className="voice-upload-placeholder"><span>{voiceMode === "AI生成" ? "✦" : voiceMode === "已有音频" ? "≡" : "⇧"}</span><h4>{voiceMode === "AI生成" ? "需要绑定音色生成工作流" : voiceMode === "已有音频" ? "声音资产库接入后可选择" : "声音上传接口接入后可使用"}</h4></div>}
        <div className="voice-consistency-note"><b>声音连续性</b><p>保存后，该角色在所有集数、所有分镜中使用同一个音色配置；口型同步任务会引用相同对白音频。</p></div>
        {error && <p className="modal-error">{error}</p>}
      </div></div>
      <div className="modal-footer"><AppButton onClick={onClose}>取消</AppButton><AppButton primary disabled={saving || voiceMode !== "文本音色"} onClick={save}>{saving ? "正在保存…" : "保存并锁定音色"}</AppButton></div>
    </div></div>
  );
}

function EnvironmentModal({ projectId, preset, onClose, onSaved }: { projectId: string; preset: AudioPreset; onClose: () => void; onSaved: (preset: AudioPreset) => void }) {
  const [description, setDescription] = useState(preset.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!description.trim()) return setError("请描述这个场景持续存在的环境声音");
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/audio-presets/${preset.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, locked: true }) });
      if (!response.ok) throw new Error("场景声音场保存失败");
      const data = await response.json() as { preset: AudioPreset };
      onSaved(data.preset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "场景声音场保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}><div className="environment-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">场景声音场</p><h2>{preset.name}</h2></div><button onClick={onClose}>×</button></div>
      <div className="environment-modal-body"><div className="sound-field-visual"><span>环境底噪</span><i /><i /><i /><i /><i /></div><h3>整场统一的声音基线</h3><p>描述空间大小、混响、持续底噪和标志性环境声。所有引用该场景的分镜都会继承此配置，再叠加镜头事件音。</p><label>声音场描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：空旷旧教室，轻微风声从破窗进入，远处操场偶有鸟鸣，室内带短促混响…" /></label><div className="environment-rules"><span>✓ 跨分镜继承</span><span>✓ 统一空间混响</span><span>✓ 镜头事件音单独叠加</span></div>{error && <p className="modal-error">{error}</p>}</div>
      <div className="modal-footer"><AppButton onClick={onClose}>取消</AppButton><AppButton primary disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存并锁定声音场"}</AppButton></div>
    </div></div>
  );
}
