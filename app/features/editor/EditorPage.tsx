"use client";

import { useEffect, useMemo, useState } from "react";
import { AppButton, Pill } from "../../components/ui";
import { roleImages, sceneImages, videoImages } from "../studio/media";
import type { AudioPreset, ProjectAsset, ProjectCharacter, ProjectEpisode, ProjectShot, ProjectSummary, View } from "../studio/types";

type EditorDetail = {
  project: ProjectSummary;
  episodes: ProjectEpisode[];
  assets: ProjectAsset[];
  characters: ProjectCharacter[];
  audioPresets: AudioPreset[];
  shots: ProjectShot[];
};

export function EditorPage({ onNavigate, project: initialProject }: { onNavigate: (view: View) => void; project: ProjectSummary | null }) {
  const [detail, setDetail] = useState<EditorDetail | null>(null);
  const [segment, setSegment] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [saveState, setSaveState] = useState<"已保存" | "保存中" | "保存失败">("已保存");
  const [generationState, setGenerationState] = useState("");
  const [loading, setLoading] = useState(Boolean(initialProject));
  const projectId = initialProject?.id ?? null;
  const shots = useMemo(() => [...(detail?.shots ?? [])].sort((a, b) => a.sequence - b.sequence), [detail]);
  const selectedShot = shots[segment] ?? null;
  const selectedEpisode = detail?.episodes.find((episode) => episode.id === selectedShot?.episodeId) ?? detail?.episodes[0] ?? null;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("分镜编辑器加载失败");
        return response.json() as Promise<EditorDetail>;
      })
      .then((data) => {
        if (cancelled) return;
        const orderedShots = [...data.shots].sort((a, b) => a.sequence - b.sequence);
        setDetail(data);
        setSegment(0);
        setPrompt(orderedShots[0]?.prompt ?? "");
      })
      .catch((reason: unknown) => { if (!cancelled) setGenerationState(reason instanceof Error ? reason.message : "分镜编辑器加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !selectedShot || prompt === selectedShot.prompt) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/shots/${selectedShot.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, status: "edited" }) });
        if (!response.ok) throw new Error("保存失败");
        const data = await response.json() as { shot: ProjectShot };
        setDetail((current) => current ? { ...current, shots: current.shots.map((shot) => shot.id === data.shot.id ? data.shot : shot) } : current);
        setSaveState("已保存");
      } catch {
        setSaveState("保存失败");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, prompt, selectedShot]);

  const chooseShot = (index: number) => {
    setSegment(index);
    setPrompt(shots[index]?.prompt ?? "");
    setSaveState("已保存");
    setGenerationState("");
  };

  const submitGeneration = async () => {
    if (!projectId || !selectedShot) return;
    setGenerationState("正在提交首帧生成任务…");
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        entityType: "shot",
        entityId: selectedShot.id,
        capability: "storyboard_frame",
        payload: { prompt, aspectRatio: detail?.project.aspectRatio, stylePreset: detail?.project.stylePreset },
      }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string } };
    if (!response.ok) {
      setGenerationState(data.error?.message ?? "首帧任务提交失败");
      return;
    }
    setGenerationState(`任务已排队：${data.job?.id ?? "等待执行"}`);
  };

  const referencedCharacters = detail?.characters.filter((character) => prompt.includes(character.canonicalName)) ?? [];
  const sceneAssets = detail?.assets.filter((asset) => asset.assetType === "scene") ?? [];
  const referencedScenes = sceneAssets.filter((asset) => prompt.includes(asset.name));
  const environmentPreset = detail?.audioPresets.find((preset) => preset.id === selectedShot?.environmentPresetId) ?? null;

  if (!initialProject) {
    return <div className="editor-page"><div className="missing-project"><b>还没有选择短剧项目</b><p>请先从分集视频页面进入分镜编辑器。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div></div>;
  }

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <button className="editor-back" onClick={() => onNavigate("videos")}>‹</button><div className="editor-title"><b>{selectedEpisode ? `第${selectedEpisode.episodeNumber}集 · ${selectedEpisode.title}` : initialProject.title}</b><span>{saveState}</span></div>
        <div className="editor-config"><Pill>首帧工作流⌄</Pill><Pill>{detail?.project.aspectRatio ?? initialProject.aspectRatio}</Pill><Pill>{detail?.project.stylePreset ?? initialProject.stylePreset}</Pill></div>
        <div className="editor-top-actions"><AppButton disabled>导出</AppButton><AppButton disabled>合成整集</AppButton><button className="profile-avatar">Z</button></div>
      </header>
      {loading ? <div className="script-loading">正在读取分镜编辑器…</div> : !selectedShot ? <div className="missing-project"><b>当前项目还没有分镜</b><p>返回分集视频页面生成分镜脚本。</p><AppButton primary onClick={() => onNavigate("videos")}>返回分集视频</AppButton></div> : (
        <>
          <div className="editor-layout">
            <aside className="editor-assets">
              <div className="editor-assets-tabs"><button className="active">本集</button><button>全集</button></div>
              <div className="editor-category-tabs"><button className="active">角色</button><button>场景</button><button>素材</button><button>道具</button></div>
              <h4>角色</h4><div className="mini-asset-grid">{detail?.characters.map((character, index) => <button key={character.id}><div style={{ backgroundImage: `url(${roleImages[index % roleImages.length]})` }} /><span>{character.canonicalName}{character.voiceLocked ? " · 音色已锁定" : ""}</span></button>)}</div>
              <h4>场景</h4><div className="mini-scenes">{sceneAssets.map((asset, index) => <button key={asset.id}><div style={{ backgroundImage: `url(${sceneImages[index % sceneImages.length]})` }} /><span>{asset.name}</span></button>)}</div>
            </aside>
            <main className="storyboard-panel">
              <div className="storyboard-heading"><div><p className="eyebrow">当前分镜</p><h2>分镜 {String(segment + 1).padStart(2, "0")} · {selectedShot.title}</h2></div><div className="credit-note">预计 {Math.round(selectedShot.durationMs / 1_000)} 秒</div></div>
              <div className="referenced-assets"><span>自动引用</span>{referencedScenes.map((asset, index) => <button key={asset.id}><i style={{ backgroundImage: `url(${sceneImages[index % sceneImages.length]})` }} />{asset.name}</button>)}{referencedCharacters.map((character, index) => <button key={character.id}><i style={{ backgroundImage: `url(${roleImages[index % roleImages.length]})` }} />{character.canonicalName}</button>)}{!referencedScenes.length && !referencedCharacters.length && <small>当前描述尚未匹配项目资产名称</small>}</div>
              <div className="shot-script dynamic-shot-editor"><label>分镜描述<textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setSaveState("保存中"); }} /></label><div className="shot-editor-meta"><span>{prompt.length} 字</span><span>{environmentPreset ? `声音场：${environmentPreset.name}` : "尚未继承场景声音场"}</span></div></div>
              <div className="storyboard-actions"><AppButton disabled={saveState === "保存中"}>保存状态：{saveState}</AppButton><AppButton primary onClick={submitGeneration}>生成分镜首帧</AppButton></div>
              {generationState && <div className={`generation-state ${generationState.includes("需要先配置") ? "needs-config" : ""}`}>{generationState}</div>}
            </main>
            <aside className="video-preview-panel">
              <div className="video-stage awaiting-generation" style={{ backgroundImage: `url(${videoImages[segment % videoImages.length]})` }}><div className="awaiting-label"><b>{selectedShot.firstFrameAssetId ? "首帧已生成" : "等待生成首帧"}</b><span>{selectedShot.status}</span></div><div className="video-stage-top"><Pill dark>分镜 {String(segment + 1).padStart(2, "0")}</Pill></div></div>
              <div className="preview-tools"><button disabled>▧<span>原视频</span></button><button disabled>◇<span>提升画质</span></button><button disabled>⌁<span>擦除字幕</span></button><button disabled>⇩<span>下载</span></button></div>
              <div className="sound-continuity"><div><span>≈</span><div><b>声音连续性</b><p>{environmentPreset?.description ?? "该分镜尚未匹配场景环境音"}</p></div></div><i>{environmentPreset?.locked ? "已锁定" : "待配置"}</i></div>
            </aside>
          </div>
          <div className="timeline-panel"><div className="timeline-header"><div><b>分镜片段</b><span>{shots.length} 个片段</span></div><div><button disabled>多选</button><button disabled>智能预演</button></div></div><div className="timeline-strip">{shots.map((shot, index) => <div key={shot.id} className={`timeline-item ${segment === index ? "active" : ""}`} role="button" tabIndex={0} onClick={() => chooseShot(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") chooseShot(index); }}><div style={{ backgroundImage: `url(${videoImages[index % videoImages.length]})` }}><span>{String(index + 1).padStart(2, "0")}</span><i>{shot.firstFrameAssetId ? "✓" : "·"}</i></div><p>{Math.round(shot.durationMs / 1_000)}s</p></div>)}</div></div>
        </>
      )}
    </div>
  );
}
