"use client";

import { useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton, Pill } from "../../components/ui";
import { roleImages, sceneImages } from "../studio/media";
import type { View } from "../studio/types";

export function GlobalAssets({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [tab, setTab] = useState("素材");
  return (
    <StudioShell view="globalAssets" onNavigate={onNavigate}>
      <div className="global-assets-page page-scroll">
        <div className="global-assets-heading"><div><p className="eyebrow">资产中心</p><h1>你的创作资产，随时复用</h1><p>统一管理角色、图片、视频、声音和画布。</p></div><AppButton primary>＋ 新增资产</AppButton></div>
        <div className="global-tabs">{["素材", "角色", "商品", "画布"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        <div className="global-toolbar"><div className="search-box">⌕ <input placeholder="搜索资产名称" /></div><div><Pill>全部类型⌄</Pill><Pill>最近更新⌄</Pill><button>▦</button><button>☷</button></div></div>
        <div className="global-asset-grid">{[...roleImages, ...sceneImages].map((image, index) => <button key={`${image}-${index}`} className="global-asset-card"><div style={{ backgroundImage: `url(${image})` }}><span>{index < 4 ? "角色" : "场景"}</span></div><h3>{index < 4 ? ["林微", "陈屹", "张曼", "王老师"][index] : ["旧教室", "旧走廊", "档案室", "学校操场"][index - 4]}</h3><p>用于 1 个项目 · {index + 2} 个版本</p></button>)}</div>
      </div>
    </StudioShell>
  );
}

