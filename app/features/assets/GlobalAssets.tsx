"use client";

import { useEffect, useMemo, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import type { ProjectAsset, ProjectSummary, View } from "../studio/types";

type AccountAsset = ProjectAsset & {
  contentUrl: string | null;
  project: ProjectSummary;
};

type AssetTab = "全部" | "角色" | "场景" | "道具" | "素材";

const assetLabels: Record<string, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  material: "素材",
  segment_video: "片段视频",
  episode_video: "整集视频",
  episode_subtitle: "字幕",
  episode_subtitles: "字幕",
  dialogue_audio: "对白音频",
  segment_audio: "片段音频",
  segment_audio_mix: "片段混音",
  project_export: "整剧交付包",
};

function tabMatches(asset: AccountAsset, tab: AssetTab) {
  if (tab === "全部") return true;
  if (tab === "角色") return asset.assetType === "character";
  if (tab === "场景") return asset.assetType === "scene";
  if (tab === "道具") return asset.assetType === "prop";
  return !["character", "scene", "prop"].includes(asset.assetType);
}

function mediaType(asset: AccountAsset): string {
  try {
    const metadata = JSON.parse(asset.metadataJson) as { mediaType?: unknown };
    if (typeof metadata.mediaType === "string") return metadata.mediaType;
  } catch {
    // Invalid historical metadata should not hide an otherwise valid asset.
  }
  if (asset.assetType.includes("video")) return "video";
  if (asset.assetType.includes("audio")) return "audio";
  if (asset.assetType.includes("subtitle")) return "text";
  if (asset.assetType === "project_export" || asset.name.toLowerCase().endsWith(".zip")) return "file";
  return "image";
}

export function GlobalAssets({ onNavigate, onOpenProject }: { onNavigate: (view: View) => void; onOpenProject: (project: ProjectSummary, target: View) => void }) {
  const [tab, setTab] = useState<AssetTab>("全部");
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<AccountAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      const data = await response.json() as { assets?: AccountAsset[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "资产加载失败");
      setAssets(data.assets ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assets", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { assets?: AccountAsset[]; error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "资产加载失败");
        return data.assets ?? [];
      })
      .then((rows) => { if (!cancelled) setAssets(rows); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "资产加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleAssets = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => tabMatches(asset, tab) && (!keyword || asset.name.toLocaleLowerCase().includes(keyword) || asset.project.title.toLocaleLowerCase().includes(keyword)));
  }, [assets, query, tab]);

  return (
    <StudioShell view="globalAssets" onNavigate={onNavigate}>
      <div className="global-assets-page page-scroll">
        <div className="global-assets-heading"><div><p className="eyebrow">资产中心</p><h1>所有项目的真实资产</h1><p>这里汇总已提取、上传或生成的角色、场景、道具和媒体结果。</p></div><AppButton primary onClick={() => onNavigate("drama")}>进入项目添加资产</AppButton></div>
        <div className="global-tabs">{(["全部", "角色", "场景", "道具", "素材"] as AssetTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<small>{assets.filter((asset) => tabMatches(asset, item)).length}</small></button>)}</div>
        <div className="global-toolbar"><div className="search-box">⌕ <input aria-label="搜索资产" placeholder="搜索资产或项目名称" value={query} onChange={(event) => setQuery(event.target.value)} /></div><AppButton onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</AppButton></div>
        {error && <div className="global-assets-empty"><b>资产读取失败</b><p>{error}</p><AppButton onClick={() => void load()}>重新读取</AppButton></div>}
        {!error && loading && <div className="global-assets-empty"><b>正在读取账号资产…</b></div>}
        {!error && !loading && !visibleAssets.length && <div className="global-assets-empty"><b>{assets.length ? "没有符合条件的资产" : "还没有真实资产"}</b><p>{assets.length ? "请尝试其他关键词或分类。" : "打开一个短剧项目，确认剧本资产或上传素材后会出现在这里。"}</p>{!assets.length && <AppButton primary onClick={() => onNavigate("drama")}>打开我的短剧</AppButton>}</div>}
        {!error && !loading && Boolean(visibleAssets.length) && <div className="global-asset-grid">{visibleAssets.map((asset) => {
          const kind = mediaType(asset);
          const imageUrl = kind === "image" ? asset.contentUrl : null;
          return <button key={asset.id} className="global-asset-card" onClick={() => onOpenProject(asset.project, ["episode_video", "segment_video", "project_export"].includes(asset.assetType) ? "videos" : "assets")}><div className={imageUrl ? "has-real-asset" : `asset-file-placeholder ${kind}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>{!imageUrl && <strong>{kind === "video" ? "▶" : kind === "audio" ? "♬" : kind === "text" ? "TXT" : kind === "file" ? "ZIP" : "◇"}</strong>}<span>{assetLabels[asset.assetType] ?? asset.assetType}</span><i>{asset.status === "ready" ? "已就绪" : asset.status}</i></div><h3>{asset.name}</h3><p>{asset.project.title} · 点击进入项目</p></button>;
        })}</div>}
      </div>
    </StudioShell>
  );
}
