"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type View =
  | "login"
  | "home"
  | "drama"
  | "script"
  | "assets"
  | "videos"
  | "editor"
  | "canvas"
  | "globalAssets";

type AssetTab = "角色" | "场景" | "道具" | "素材";

const roleImages = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=720&q=88",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=720&q=88",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=720&q=88",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=720&q=88",
];

const sceneImages = [
  "https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=960&q=88",
  "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=960&q=88",
  "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=960&q=88",
  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=960&q=88",
];

const videoImages = [
  sceneImages[0],
  "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=960&q=88",
  "https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=960&q=88",
];

const assetCounts: Record<AssetTab, number> = {
  角色: 5,
  场景: 11,
  道具: 1,
  素材: 1,
};

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark">象</span>
      {!compact && <span className="brand-name">小飞象</span>}
    </div>
  );
}

function Pill({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <span className={`pill ${dark ? "pill-dark" : ""}`}>{children}</span>;
}

function AppButton({
  children,
  primary = false,
  disabled = false,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      className={`app-button ${primary ? "primary" : ""} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Login({ onEnter }: { onEnter: () => void }) {
  const [phone, setPhone] = useState("138 6355 4010");
  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="login-brand"><Logo /></div>
        <div className="showcase-copy">
          <Pill dark>一人剧组 · 灵感马上成片</Pill>
          <h1>从一个故事，<br />到一部完整短剧。</h1>
          <p>剧本、角色、场景、分镜与成片，在同一个创作空间自然流动。</p>
        </div>
        <div className="showcase-film">
          {videoImages.map((image, index) => (
            <div className={`film-frame film-${index + 1}`} key={image} style={{ backgroundImage: `url(${image})` }}>
              <span>0{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="showcase-footer"><span>SHORT DRAMA STUDIO</span><span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <Logo />
          <div className="login-title">
            <h2>欢迎回来</h2>
            <p>登录后继续你的小飞象创作</p>
          </div>
          <label className="field-label">手机号</label>
          <div className="phone-field">
            <span>+86</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="手机号" />
          </div>
          <label className="field-label">验证码</label>
          <div className="code-field">
            <input defaultValue="8866" aria-label="验证码" />
            <button>获取验证码</button>
          </div>
          <button className="login-submit" onClick={onEnter}>进入小飞象</button>
          <label className="agreement"><input type="checkbox" defaultChecked /> 我已阅读并同意服务协议与隐私政策</label>
          <div className="login-divider"><span>或</span></div>
          <button className="douyin-login"><span>♪</span> 使用抖音账号登录</button>
        </div>
      </section>
    </main>
  );
}

function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <nav className="main-nav" aria-label="主导航">
        <button className={view === "home" ? "active" : ""} onClick={() => onNavigate("home")}><span>✦</span>创作</button>
        <button className={["drama", "script", "assets", "videos", "editor"].includes(view) ? "active" : ""} onClick={() => onNavigate("drama")}><span>▣</span>短剧 Agent</button>
        <button className={view === "globalAssets" ? "active" : ""} onClick={() => onNavigate("globalAssets")}><span>◇</span>资产</button>
      </nav>
      <div className="history-heading"><span>创作历史</span><button>查看全部</button></div>
      <div className="history-list">
        <button onClick={() => onNavigate("script")}><span className="history-dot blue" />旧教室的第三排</button>
        <button><span className="history-dot amber" />崇祯新变</button>
        <button><span className="history-dot violet" />十日终焉：天马试炼</button>
      </div>
      <div className="sidebar-bottom">
        <button><span>?</span>帮助与反馈</button>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <button className="top-link">CLI / API</button>
      <button className="top-link"><span className="online-dot" />连接工作引擎</button>
      <button className="icon-button" aria-label="通知">◌<span className="notification-dot" /></button>
      <button className="profile-button"><span className="profile-avatar">Z</span><span>创作者</span><b>⌄</b></button>
    </header>
  );
}

function Shell({
  view,
  onNavigate,
  children,
}: {
  view: View;
  onNavigate: (view: View) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={onNavigate} />
      <div className="app-main">
        <Topbar />
        {children}
      </div>
    </div>
  );
}

function Home({ onNavigate }: { onNavigate: (view: View) => void }) {
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
    <Shell view="home" onNavigate={onNavigate}>
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
    </Shell>
  );
}

function DramaHub({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [mode, setMode] = useState<"上传剧本" | "AI 生剧本" | "自由画布">("上传剧本");
  const [text, setText] = useState("");
  return (
    <Shell view="drama" onNavigate={onNavigate}>
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
    </Shell>
  );
}

function ProjectTop({
  step,
  onNavigate,
}: {
  step: 1 | 2 | 3;
  onNavigate: (view: View) => void;
}) {
  const steps: Array<[number, string, View]> = [
    [1, "剧本大纲", "script"],
    [2, "资产库", "assets"],
    [3, "分集视频", "videos"],
  ];
  return (
    <div className="project-top">
      <button className="project-back" onClick={() => onNavigate("drama")}>‹</button>
      <div className="project-name"><h1>旧教室的第三排</h1><span>自动保存于 15:32</span></div>
      <div className="project-steps">
        {steps.map(([number, label, target]) => (
          <button key={number} className={`${step === number ? "active" : ""} ${number < step ? "done" : ""}`} onClick={() => onNavigate(target)}>
            <span>{number < step ? "✓" : number}</span>{label}
          </button>
        ))}
      </div>
      <div className="project-settings"><Pill>90年代写实电影风格</Pill><Pill>16:9</Pill></div>
    </div>
  );
}

function ScriptPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [episode, setEpisode] = useState(1);
  const [tab, setTab] = useState<"原始创意" | "剧本摘要" | "分集剧本">("分集剧本");
  const [extracting, setExtracting] = useState(false);
  const [locked, setLocked] = useState(false);
  const extract = () => {
    setExtracting(true);
    window.setTimeout(() => { setExtracting(false); setLocked(true); }, 1200);
  };
  return (
    <Shell view="script" onNavigate={onNavigate}>
      <ProjectTop step={1} onNavigate={onNavigate} />
      <div className="project-body script-body">
        <aside className="episode-sidebar">
          <div><h3>分集剧本</h3><Pill>3 集</Pill></div>
          {[1, 2, 3].map((item) => (
            <button key={item} className={episode === item ? "active" : ""} onClick={() => setEpisode(item)}>
              <span>0{item}</span><div><b>{item === 1 ? "旧教室重逢" : item === 2 ? "十七年真相" : "误解终于解开"}</b><small>{item === 3 ? "待确认" : locked ? "资产已提取" : "剧本已生成"}</small></div><i className={item === 3 ? "pending" : "ready"} />
            </button>
          ))}
          <button className="add-episode">＋ 新增一集</button>
        </aside>
        <main className="script-workspace">
          <div className="workspace-header">
            <div><p className="eyebrow">第 {episode} 集</p><h2>{episode === 1 ? "旧教室重逢揭开尘封往事" : episode === 2 ? "十七年真相浮出水面" : "十七年误解一朝解开"}</h2></div>
            <div><AppButton>批量选择</AppButton><AppButton>重新生成</AppButton></div>
          </div>
          <div className="content-tabs">
            {(["原始创意", "剧本摘要", "分集剧本"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
          </div>
          {tab !== "分集剧本" ? (
            <div className="summary-card"><h3>{tab}</h3><p>{tab === "原始创意" ? "十七年前，一封没有寄出的信让五个人的人生走向完全不同的方向。多年后，他们在即将拆除的旧教学楼里再次相遇。" : "林微回到县城老中学整理旧物，在旧教室遇见多年未见的陈屹。一次意外发现，让两人重新追查当年被掩盖的真相。"}</p></div>
          ) : (
            <div className={`episode-script ${locked ? "locked" : ""}`}>
              {locked && <div className="lock-banner"><span>⌁</span><div><b>资产已拆解，本集剧本已锁定</b><p>角色、场景和道具已进入资产库，修改剧本可能影响后续内容。</p></div></div>}
              <div className="scene-block"><div className="scene-number">01</div><div><h3>旧教室 · 日 · 内</h3><p className="scene-meta">人物：林微　场景：县城老中学旧教室</p><p>阳光从落满灰尘的窗户斜照进来。林微蹲在一堆旧物前，手机开着免提。</p><p><b>画外音（中年女性）：</b>微姐，那男的条件真不错，你就去见一面呗？</p><p><b>林微：</b>我习惯一个人了，这样挺好。</p></div></div>
              <div className="scene-block"><div className="scene-number">02</div><div><h3>旧走廊 · 日 · 内</h3><p className="scene-meta">人物：林微、陈屹　场景：教学楼旧走廊</p><p>走廊尽头传来缓慢的脚步声。林微抬起头，十七年未见的陈屹站在逆光中。</p><p><b>陈屹：</b>你果然还是回来了。</p></div></div>
            </div>
          )}
          <div className="script-footer">
            <div><span className="status-dot" />3 集剧本已生成，2 集等待资产提取</div>
            {locked ? <AppButton primary onClick={() => onNavigate("assets")}>进入资产库 →</AppButton> : <AppButton primary onClick={extract}>{extracting ? "正在提取资产…" : "提取角色与场景 →"}</AppButton>}
          </div>
        </main>
      </div>
    </Shell>
  );
}

function AssetsPage({ onNavigate }: { onNavigate: (view: View) => void }) {
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
    <Shell view="assets" onNavigate={onNavigate}>
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
    </Shell>
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

type FlowNode = {
  id: string;
  kind: "idea" | "role" | "scene" | "prop" | "shot" | "video";
  title: string;
  meta: string;
  image?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FlowEdge = { id: string; from: string; to: string; label: string };

const initialFlowNodes: FlowNode[] = [
  { id: "idea", kind: "idea", title: "故事灵感", meta: "旧教室里，一封迟到十七年的信让两个人再次相遇。", x: 40, y: 120, width: 230, height: 146 },
  { id: "linwei", kind: "role", title: "林微 · 成年时期", meta: "主角 · 已绑定固定音色", image: roleImages[0], x: 330, y: 54, width: 204, height: 226 },
  { id: "chenyi", kind: "role", title: "陈屹 · 成年时期", meta: "主角 · 克制低沉男声", image: roleImages[1], x: 330, y: 330, width: 204, height: 226 },
  { id: "school", kind: "scene", title: "废弃的旧教室", meta: "日 · 内 · 午后逆光", image: sceneImages[0], x: 620, y: 170, width: 224, height: 218 },
  { id: "letter", kind: "prop", title: "未寄出的旧信", meta: "关键道具 · 贯穿第 1–3 集", x: 630, y: 460, width: 210, height: 138 },
  { id: "shot", kind: "shot", title: "片段 01 · 重逢", meta: "首帧已生成 · 16:9", image: videoImages[0], x: 920, y: 208, width: 232, height: 226 },
  { id: "video", kind: "video", title: "片段 01 · 动态视频", meta: "V3 · 00:15 · 含原生声音", image: videoImages[1], x: 1240, y: 208, width: 232, height: 226 },
];

const initialFlowEdges: FlowEdge[] = [
  { id: "e1", from: "idea", to: "linwei", label: "提取角色" },
  { id: "e2", from: "idea", to: "chenyi", label: "提取角色" },
  { id: "e3", from: "linwei", to: "school", label: "角色引用" },
  { id: "e4", from: "chenyi", to: "school", label: "同场人物" },
  { id: "e5", from: "school", to: "shot", label: "生成首帧" },
  { id: "e6", from: "letter", to: "shot", label: "道具引用" },
  { id: "e7", from: "shot", to: "video", label: "图生视频" },
];

function FlowCanvasLines({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(parent.clientWidth, 1510);
      const height = parent.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      edges.forEach((edge) => {
        const source = nodes.find((node) => node.id === edge.from);
        const target = nodes.find((node) => node.id === edge.to);
        if (!source || !target) return;
        const startX = source.x + source.width;
        const startY = source.y + source.height / 2;
        const endX = target.x;
        const endY = target.y + target.height / 2;
        const bend = Math.max(70, Math.abs(endX - startX) * 0.48);
        const gradient = context.createLinearGradient(startX, startY, endX, endY);
        gradient.addColorStop(0, "rgba(102, 116, 226, .92)");
        gradient.addColorStop(1, "rgba(149, 157, 222, .88)");
        context.beginPath();
        context.moveTo(startX, startY);
        context.bezierCurveTo(startX + bend, startY, endX - bend, endY, endX, endY);
        context.lineWidth = 8;
        context.strokeStyle = "rgba(91, 104, 196, .1)";
        context.stroke();
        context.beginPath();
        context.moveTo(startX, startY);
        context.bezierCurveTo(startX + bend, startY, endX - bend, endY, endX, endY);
        context.lineWidth = 2;
        context.strokeStyle = gradient;
        context.stroke();
        context.beginPath();
        context.arc(endX - 5, endY, 4, 0, Math.PI * 2);
        context.fillStyle = "#7a85df";
        context.fill();

        const labelX = (startX + endX) / 2;
        const labelY = (startY + endY) / 2;
        context.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
        const labelWidth = context.measureText(edge.label).width + 18;
        context.fillStyle = "rgba(255, 255, 255, .98)";
        context.beginPath();
        context.roundRect(labelX - labelWidth / 2, labelY - 11, labelWidth, 22, 11);
        context.fill();
        context.strokeStyle = "rgba(142, 151, 219, .42)";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#666d91";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(edge.label, labelX, labelY + .5);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [edges, nodes]);

  return <canvas ref={canvasRef} className="flow-lines" aria-hidden="true" />;
}

function CanvasWorkspace({
  title,
  onClose,
  onContinue,
  continueLabel,
  projectId = null,
}: {
  title: string;
  onClose: () => void;
  onContinue: () => void;
  continueLabel: string;
  projectId?: string | null;
}) {
  const [nodes, setNodes] = useState(initialFlowNodes);
  const [edges, setEdges] = useState(initialFlowEdges);
  const [selected, setSelected] = useState("shot");
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [zoom, setZoom] = useState(82);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [saveState, setSaveState] = useState<"本地草稿" | "正在载入" | "已自动保存" | "保存中" | "保存失败">(projectId ? "正在载入" : "本地草稿");
  const dragRef = useRef<{ id: string; dx: number; dy: number; parent: HTMLElement } | null>(null);
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[0];

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/canvas`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("LOAD_FAILED")))
      .then((data: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }) => {
        if (cancelled) return;
        if (data.nodes?.length) {
          setNodes(data.nodes.map((item) => ({
            id: String(item.id),
            kind: String(item.nodeType) as FlowNode["kind"],
            title: String(item.title),
            meta: String((item.content as { meta?: unknown } | undefined)?.meta ?? ""),
            image: typeof (item.content as { image?: unknown } | undefined)?.image === "string" ? String((item.content as { image?: unknown }).image) : undefined,
            x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height),
          })));
          setEdges((data.edges ?? []).map((item) => ({ id: String(item.id), from: String(item.fromNodeId), to: String(item.toNodeId), label: String(item.label ?? "内容关联") })));
        }
        setPersistenceReady(true);
        setSaveState("已自动保存");
      })
      .catch(() => { if (!cancelled) setSaveState("保存失败"); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !persistenceReady) return;
    const timer = window.setTimeout(() => {
      setSaveState("保存中");
      fetch(`/api/projects/${projectId}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodes: nodes.map((node) => ({ id: node.id, nodeType: node.kind, title: node.title, content: { meta: node.meta, image: node.image }, x: node.x, y: node.y, width: node.width, height: node.height })),
          edges: edges.map((edge) => ({ id: edge.id, fromNodeId: edge.from, toNodeId: edge.to, label: edge.label, edgeType: "reference" })),
        }),
      }).then((response) => { if (!response.ok) throw new Error("SAVE_FAILED"); setSaveState("已自动保存"); }).catch(() => setSaveState("保存失败"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [edges, nodes, persistenceReady, projectId]);

  const addNode = (kind: FlowNode["kind"]) => {
    const count = nodes.filter((node) => node.kind === kind).length + 1;
    const labels: Record<FlowNode["kind"], [string, string]> = {
      idea: ["新故事段落", "双击编辑故事内容"],
      role: [`新角色 ${count}`, "待上传形象与绑定音色"],
      scene: [`新场景 ${count}`, "待生成场景标准图"],
      prop: [`新道具 ${count}`, "待补充道具设定"],
      shot: [`新分镜 ${count}`, "等待引用资产生成"],
      video: [`新视频 ${count}`, "等待分镜生成视频"],
    };
    const node: FlowNode = {
      id: `${kind}-${Date.now()}`,
      kind,
      title: labels[kind][0],
      meta: labels[kind][1],
      x: 590 + count * 28,
      y: 260 + count * 24,
      width: kind === "scene" || kind === "shot" || kind === "video" ? 244 : 220,
      height: kind === "idea" || kind === "prop" ? 138 : 204,
    };
    setNodes((current) => [...current, node]);
    setSelected(node.id);
  };

  const connectTo = (targetId: string) => {
    if (!connectingFrom || connectingFrom === targetId) return;
    const exists = edges.some((edge) => edge.from === connectingFrom && edge.to === targetId);
    if (!exists) setEdges((current) => [...current, { id: `edge-${Date.now()}`, from: connectingFrom, to: targetId, label: "内容关联" }]);
    setConnectingFrom(null);
    setSelected(targetId);
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>, node: FlowNode) => {
    if ((event.target as HTMLElement).closest("button")) return;
    setSelected(node.id);
    const parent = event.currentTarget.offsetParent as HTMLElement | null;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    dragRef.current = {
      id: node.id,
      dx: event.clientX - bounds.left + parent.scrollLeft - node.x,
      dy: event.clientY - bounds.top + parent.scrollTop - node.y,
      parent,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragNode = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const { id, dx, dy, parent } = dragRef.current;
    const bounds = parent.getBoundingClientRect();
    const x = event.clientX - bounds.left + parent.scrollLeft - dx;
    const y = event.clientY - bounds.top + parent.scrollTop - dy;
    setNodes((current) => current.map((node) => node.id === id ? { ...node, x: Math.max(20, x), y: Math.max(20, y) } : node));
  };

  return (
    <div className="flow-workspace">
      <header className="flow-topbar">
        <div className="flow-title"><button onClick={onClose} aria-label="返回">←</button><Logo /><span>/</span><div><b>{title}</b><small>{saveState}{saveState === "已自动保存" ? " · 刚刚" : ""}</small></div></div>
        <div className="flow-top-actions"><button className="flow-collaborator"><i>Z</i> 仅自己</button><button>↶</button><button>↷</button><AppButton primary onClick={onContinue}>{continueLabel}</AppButton></div>
      </header>
      <div className="flow-body">
        <aside className="flow-toolbar">
          <button className={libraryOpen ? "active" : ""} onClick={() => setLibraryOpen(!libraryOpen)}><b>◇</b><span>节点</span></button>
          <button><b>T</b><span>文本</span></button>
          <button><b>⇧</b><span>上传</span></button>
          <button><b>✦</b><span>AI生成</span></button>
          <div />
          <button><b>?</b><span>帮助</span></button>
        </aside>
        {libraryOpen && <aside className="flow-library">
          <div className="flow-library-head"><div><small>节点素材库</small><h3>添加到画布</h3></div><button onClick={() => setLibraryOpen(false)}>×</button></div>
          <div className="flow-search">⌕ 搜索角色、场景、内容…</div>
          <section><label>故事结构</label><button onClick={() => addNode("idea")}><i className="node-symbol idea">文</i><div><b>故事文本</b><span>灵感、剧本或分镜描述</span></div><em>＋</em></button><button onClick={() => addNode("shot")}><i className="node-symbol shot">镜</i><div><b>分镜节点</b><span>组织镜头与画面提示词</span></div><em>＋</em></button></section>
          <section><label>资产</label><button onClick={() => addNode("role")}><i className="node-symbol role">角</i><div><b>角色资产</b><span>形象、形态与固定音色</span></div><em>＋</em></button><button onClick={() => addNode("scene")}><i className="node-symbol scene">景</i><div><b>场景资产</b><span>地点、时间与光照</span></div><em>＋</em></button><button onClick={() => addNode("prop")}><i className="node-symbol prop">物</i><div><b>道具资产</b><span>保持关键物件一致</span></div><em>＋</em></button></section>
          <section><label>输出</label><button onClick={() => addNode("video")}><i className="node-symbol video">▶</i><div><b>视频生成</b><span>连接分镜后生成动态结果</span></div><em>＋</em></button></section>
          <div className="flow-tip"><b>连接节点</b><p>点击节点右侧输出点，再点击目标节点左侧输入点。</p></div>
        </aside>}
        <main className={`flow-stage ${libraryOpen ? "library-visible" : ""}`}>
          <FlowCanvasLines nodes={nodes} edges={edges} />
          {connectingFrom && <div className="connect-banner"><span className="pulse-dot" />正在连接：请选择目标节点左侧的输入点 <button onClick={() => setConnectingFrom(null)}>取消</button></div>}
          {nodes.map((node) => (
            <article
              key={node.id}
              className={`flow-node ${node.kind} ${selected === node.id ? "selected" : ""}`}
              style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
              onPointerDown={(event) => beginDrag(event, node)}
              onPointerMove={dragNode}
              onPointerUp={() => { dragRef.current = null; }}
              onClick={() => setSelected(node.id)}
            >
              <button className={`flow-port input ${connectingFrom ? "ready" : ""}`} aria-label={`连接到${node.title}`} onClick={(event) => { event.stopPropagation(); connectTo(node.id); }} />
              <div className="node-head"><span><i className={`node-symbol ${node.kind}`}>{node.kind === "role" ? "角" : node.kind === "scene" ? "景" : node.kind === "prop" ? "物" : node.kind === "shot" ? "镜" : node.kind === "video" ? "▶" : "文"}</i>{node.kind === "role" ? "角色" : node.kind === "scene" ? "场景" : node.kind === "prop" ? "道具" : node.kind === "shot" ? "分镜" : node.kind === "video" ? "视频" : "故事"}</span><button aria-label="节点菜单">•••</button></div>
              {node.image && <div className="flow-node-image" style={{ backgroundImage: `url(${node.image})` }}>{node.kind === "video" && <i>▶</i>}</div>}
              <div className="node-copy"><b>{node.title}</b><p>{node.meta}</p></div>
              {node.kind === "idea" && <div className="idea-tags"><span>#校园</span><span>#重逢</span><span>#悬疑</span></div>}
              {node.kind === "role" && <div className="node-state">♬ 音色已锁定</div>}
              <button className="flow-port output" aria-label={`从${node.title}建立连接`} onClick={(event) => { event.stopPropagation(); setConnectingFrom(node.id); setSelected(node.id); }} />
            </article>
          ))}
          <div className="flow-zoom"><button>⌖</button><button onClick={() => setZoom(Math.max(40, zoom - 10))}>−</button><span>{zoom}%</span><button onClick={() => setZoom(Math.min(140, zoom + 10))}>＋</button></div>
          <div className="flow-minimap">{nodes.map((node) => <i key={node.id} style={{ left: node.x / 12, top: node.y / 10 }} />)}<b /></div>
        </main>
        <aside className="flow-inspector">
          <div className="inspector-title"><div><small>节点设置</small><h3>{selectedNode.title}</h3></div><button>×</button></div>
          <div className="inspector-preview" style={selectedNode.image ? { backgroundImage: `url(${selectedNode.image})` } : undefined}>{!selectedNode.image && <span>{selectedNode.kind === "idea" ? "文" : "✦"}</span>}</div>
          <label>节点名称<input value={selectedNode.title} onChange={(event) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, title: event.target.value } : node))} /></label>
          <label>内容提示词<textarea value={selectedNode.meta} onChange={(event) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, meta: event.target.value } : node))} /></label>
          <div className="inspector-section"><label>输入引用</label><div className="input-relations">{edges.filter((edge) => edge.to === selectedNode.id).length ? edges.filter((edge) => edge.to === selectedNode.id).map((edge) => <span key={edge.id}>↳ {nodes.find((node) => node.id === edge.from)?.title}</span>) : <p>尚未连接输入节点</p>}</div></div>
          <div className="inspector-actions"><AppButton>复制节点</AppButton><AppButton primary>生成新版本</AppButton></div>
        </aside>
      </div>
    </div>
  );
}

function CanvasOverlay({ onClose, onContinue }: { onClose: () => void; onContinue: () => void }) {
  return <CanvasWorkspace title="旧教室的第三排 · 资产画布" onClose={onClose} onContinue={onContinue} continueLabel="确认资产，进入分镜 →" />;
}

function FreeCanvasPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ensureProject = async () => {
      const listResponse = await fetch("/api/projects", { cache: "no-store" });
      if (!listResponse.ok) return;
      const list = await listResponse.json() as { projects?: Array<{ id: string; sourceType: string; title: string }> };
      const existing = list.projects?.find((project) => project.sourceType === "canvas" && project.title === "校园悬疑灵感");
      if (existing) { if (!cancelled) setProjectId(existing.id); return; }
      const createResponse = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "校园悬疑灵感", sourceType: "canvas", synopsis: "旧教室里，一封迟到十七年的信让两个人再次相遇。" }) });
      if (!createResponse.ok) return;
      const created = await createResponse.json() as { project?: { id: string } };
      if (!cancelled && created.project?.id) setProjectId(created.project.id);
    };
    ensureProject().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return <CanvasWorkspace title="自由画布 · 校园悬疑灵感" projectId={projectId} onClose={() => onNavigate("home")} onContinue={() => onNavigate("drama")} continueLabel="整理为短剧项目 →" />;
}

function VideosPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <Shell view="videos" onNavigate={onNavigate}>
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
    </Shell>
  );
}

function EditorPage({ onNavigate }: { onNavigate: (view: View) => void }) {
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

function GlobalAssets({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [tab, setTab] = useState("素材");
  return (
    <Shell view="globalAssets" onNavigate={onNavigate}>
      <div className="global-assets-page page-scroll">
        <div className="global-assets-heading"><div><p className="eyebrow">资产中心</p><h1>你的创作资产，随时复用</h1><p>统一管理角色、图片、视频、声音和画布。</p></div><AppButton primary>＋ 新增资产</AppButton></div>
        <div className="global-tabs">{["素材", "角色", "商品", "画布"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        <div className="global-toolbar"><div className="search-box">⌕ <input placeholder="搜索资产名称" /></div><div><Pill>全部类型⌄</Pill><Pill>最近更新⌄</Pill><button>▦</button><button>☷</button></div></div>
        <div className="global-asset-grid">{[...roleImages, ...sceneImages].map((image, index) => <button key={`${image}-${index}`} className="global-asset-card"><div style={{ backgroundImage: `url(${image})` }}><span>{index < 4 ? "角色" : "场景"}</span></div><h3>{index < 4 ? ["林微", "陈屹", "张曼", "王老师"][index] : ["旧教室", "旧走廊", "档案室", "学校操场"][index - 4]}</h3><p>用于 1 个项目 · {index + 2} 个版本</p></button>)}</div>
      </div>
    </Shell>
  );
}

export default function HomePage() {
  const [view, setView] = useState<View>("login");
  if (view === "login") return <Login onEnter={() => setView("home")} />;
  if (view === "home") return <Home onNavigate={setView} />;
  if (view === "drama") return <DramaHub onNavigate={setView} />;
  if (view === "script") return <ScriptPage onNavigate={setView} />;
  if (view === "assets") return <AssetsPage onNavigate={setView} />;
  if (view === "videos") return <VideosPage onNavigate={setView} />;
  if (view === "editor") return <EditorPage onNavigate={setView} />;
  if (view === "canvas") return <FreeCanvasPage onNavigate={setView} />;
  return <GlobalAssets onNavigate={setView} />;
}
