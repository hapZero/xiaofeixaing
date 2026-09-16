"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudioShell } from "../../components/layout/StudioShell";
import { AppButton } from "../../components/ui";
import { ProjectTop } from "../project/ProjectTop";
import type { ProjectEpisode, ProjectGenerationJob, ProjectSummary, StoryBible, View } from "../studio/types";
import { friendlyGenerationError, projectAssetsReady, projectScriptPhaseComplete } from "../../lib/project-step-navigation";
import { isStoryOutlineReady } from "../../lib/drama-outline";
import { parseStoryOutline, type OutlineCharacter } from "./script-outline";

type ProjectDetailResponse = {
  project: ProjectSummary;
  storyBible: StoryBible | null;
  episodes: ProjectEpisode[];
  assets?: Array<{ id: string }>;
  generationJobs?: ProjectGenerationJob[];
};

const textJobCapabilities = ["llm_script", "llm_structure", "llm_episode", "llm_analysis"];

function textJobMessage(capability: string, stage?: string | null, outlineReady = false) {
  if (capability === "llm_analysis") return "文本智能正在研读全剧，并生成资产清单、片段与分镜草案…";
  if (capability === "llm_structure") return "文本智能正在完整保留原稿，并整理剧本摘要、人物小传与分集剧本…";
  if (capability === "llm_episode") return "文本智能正在按已锁定大纲重写当前分集正文…";
  if (capability === "llm_script" && stage === "outline") return "第 1 步：正在生成剧本摘要与人物小传…";
  if (capability === "llm_script" && (stage === "episodes" || outlineReady)) return "第 2 步：正在依据摘要与人物小传写入分集正文…";
  if (capability === "llm_script") return "正在按顺序生成：摘要与人物小传 → 分集正文…";
  return "文本智能正在处理剧本…";
}

function textJobHint(capability: string, stage?: string | null, outlineReady = false) {
  if (capability === "llm_analysis") return "全剧剧本已确认，正在提取角色、场景与道具；完成后会自动进入资产库";
  if (capability === "llm_structure") return "完整保留上传原稿，仅整理摘要、人物与分集结构";
  if (capability === "llm_episode") return "仅重写当前分集，不会改动全剧摘要与其他分集";
  if (capability === "llm_script" && stage === "outline") return "摘要与人物小传完成后，才会解锁分集正文";
  if (capability === "llm_script" && (stage === "episodes" || outlineReady)) return "分集正文会严格依据已锁定的摘要与人物小传展开";
  if (capability === "llm_script") return "按顺序执行：摘要与人物小传 → 分集正文";
  return "处理完成后页面会自动刷新";
}

function resolveScriptJobStage(job: ProjectGenerationJob | undefined, outlineReady: boolean) {
  if (!job) return null;
  let stage: string | null = null;
  try {
    stage = (JSON.parse(job.resultJson || "{}") as { stage?: string }).stage ?? null;
  } catch {
    stage = null;
  }
  if (job.capability === "llm_script" && outlineReady && stage !== "complete") return "episodes";
  return stage;
}

const characterFieldLabels: Array<{ key: keyof OutlineCharacter; label: string }> = [
  { key: "roleType", label: "角色类型" },
  { key: "visualImage", label: "视觉形象" },
  { key: "coreTags", label: "核心标签" },
  { key: "background", label: "身份背景" },
  { key: "growthHistory", label: "成长经历" },
  { key: "personality", label: "性格特点" },
  { key: "relationships", label: "人物关系" },
  { key: "growthArc", label: "成长变化" },
];

function ScriptOutlineSummaryBody({ outline }: { outline: ReturnType<typeof parseStoryOutline> }) {
  return (
    <>
      <dl className="script-outline-summary">
        <div><dt>计划集数</dt><dd>{outline.plannedEpisodeCount} 集</dd></div>
        {outline.genre ? <div><dt>故事类型</dt><dd>{outline.genre}</dd></div> : null}
        {outline.targetAudience ? <div><dt>目标受众</dt><dd>{outline.targetAudience}</dd></div> : null}
        {outline.coreHooks.length ? <div className="full"><dt>核心梗</dt><dd><div className="script-outline-tags">{outline.coreHooks.map((hook) => <span key={hook}>{hook}</span>)}</div></dd></div> : null}
        <div className="full"><dt>一句话故事</dt><dd>{outline.logline}</dd></div>
        {outline.premise ? <div className="full"><dt>世界观</dt><dd>{outline.premise}</dd></div> : null}
        {outline.tone ? <div className="full"><dt>叙事基调</dt><dd>{outline.tone}</dd></div> : null}
      </dl>
      <div className="script-outline-characters-block">
        <div className="script-outline-characters-heading"><b>人物小传</b><span>{`${outline.characters.length} 位角色`}</span></div>
        <div className="script-character-list">{outline.characters.map((character) => (
          <article key={character.name} className="script-character-card">
            <header><b>{character.name}</b><span>{character.roleType}</span></header>
            <dl>{characterFieldLabels.map(({ key, label }) => character[key] ? <div key={key}><dt>{label}</dt><dd>{character[key]}</dd></div> : null)}</dl>
          </article>
        ))}</div>
      </div>
    </>
  );
}

export function ScriptPage({ onNavigate, projectId }: { onNavigate: (view: View) => void; projectId: string | null }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [episodes, setEpisodes] = useState<ProjectEpisode[]>([]);
  const [generationJobs, setGenerationJobs] = useState<ProjectGenerationJob[]>([]);
  const [hasSavedAssetLibrary, setHasSavedAssetLibrary] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [loading, setLoading] = useState(Boolean(projectId));
  const [saveState, setSaveState] = useState<"已保存" | "保存中" | "保存失败">("已保存");
  const [ideaSaveState, setIdeaSaveState] = useState<"已保存" | "保存中" | "保存失败">("已保存");
  const [analysisState, setAnalysisState] = useState("");
  const [confirmingScript, setConfirmingScript] = useState(false);
  const [addingEpisode, setAddingEpisode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [retryingDrama, setRetryingDrama] = useState(false);
  const [error, setError] = useState("");

  const selectedEpisode = useMemo(
    () => episodes.find((episode) => episode.id === selectedEpisodeId) ?? episodes[0] ?? null,
    [episodes, selectedEpisodeId],
  );

  const projectForNavigation = useMemo(
    () => project && hasSavedAssetLibrary ? { ...project, status: "assets" } : project,
    [hasSavedAssetLibrary, project],
  );

  const outline = useMemo(() => parseStoryOutline({
    project: projectForNavigation,
    storyBible,
    episodes,
    generationJobs,
    selectedEpisodeId,
    selectedScriptText: scriptText,
  }), [projectForNavigation, storyBible, episodes, generationJobs, selectedEpisodeId, scriptText]);

  const loadProject = useCallback(async (preferredEpisodeId?: string) => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("项目加载失败");
    const data = await response.json() as ProjectDetailResponse;
    setProject(data.project);
    setStoryBible(data.storyBible ?? null);
    setEpisodes(data.episodes ?? []);
    setGenerationJobs(data.generationJobs ?? []);
    const hasPersistedAssets = Boolean(data.assets?.length);
    setHasSavedAssetLibrary(hasPersistedAssets);
    setIdeaDraft(data.project.synopsis?.trim() || data.storyBible?.logline?.trim() || "");
    setIdeaSaveState("已保存");
    const first = data.episodes?.[0];
    const selected = data.episodes.find((episode) => episode.id === preferredEpisodeId) ?? first;
    setSelectedEpisodeId(selected?.id ?? null);
    setScriptText(selected?.scriptText ?? "");
    const failedTextJob = data.generationJobs?.find((job) => textJobCapabilities.includes(job.capability) && job.status === "failed");
    const episodesComplete = (data.episodes ?? []).every((episode) => episode.scriptText?.trim());
    const outlineReady = isStoryOutlineReady(data.storyBible ?? null);
    if (hasPersistedAssets && failedTextJob?.capability === "llm_script") {
      setError("");
    } else if (failedTextJob?.capability === "llm_script" && outlineReady && episodesComplete) {
      setError("");
    } else if (failedTextJob && ["script_structure_failed", "script_generation_failed", "script_analysis_failed"].includes(data.project.status)) {
      if (failedTextJob.capability === "llm_script" && outlineReady) {
        setError(friendlyGenerationError(failedTextJob.errorMessage || "分集正文生成中断，摘要与人物小传已保留，可继续补写分集"));
      } else if (failedTextJob.capability === "llm_analysis") {
        setError(friendlyGenerationError(failedTextJob.errorMessage || "完整剧本理解失败，可再次确认全剧重试"));
      } else if (failedTextJob.capability === "llm_structure") {
        setError(friendlyGenerationError(failedTextJob.errorMessage || "上传剧本的分集整理失败，原稿已经保留"));
      } else {
        setError(friendlyGenerationError(failedTextJob.errorMessage || "摘要与人物小传生成中断，创意已保留，可重新生成"));
      }
    } else {
      setError("");
    }
    const activeText = data.generationJobs?.find((job) => textJobCapabilities.includes(job.capability) && ["queued", "running"].includes(job.status));
    if (activeText?.capability === "llm_analysis") {
      setAnalysisState(textJobMessage("llm_analysis", resolveScriptJobStage(activeText, outlineReady), outlineReady));
    } else if (!activeText) {
      setAnalysisState("");
    }
    if (projectAssetsReady(data.project.status)) {
      setConfirmingScript(false);
    }
    return data;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        await loadProject();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "项目加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [loadProject, projectId]);

  const activeTextJob = generationJobs.find((job) => textJobCapabilities.includes(job.capability) && ["queued", "running"].includes(job.status));
  const activeAnalysisJob = generationJobs.find((job) => job.capability === "llm_analysis" && ["queued", "running"].includes(job.status));
  const scriptAnalysisBusy = confirmingScript || Boolean(activeAnalysisJob);
  const activeJobStage = resolveScriptJobStage(activeTextJob, outline.outlineReady);
  const failedDramaJob = generationJobs.find((job) => job.capability === "llm_script" && job.status === "failed");
  const failedStructureJob = generationJobs.find((job) => job.capability === "llm_structure" && job.status === "failed");
  const allEpisodesHaveScripts = outline.readyEpisodeCount >= outline.plannedEpisodeCount && episodes.length > 0 && episodes.every((episode) => (
    episode.id === selectedEpisode?.id ? scriptText : episode.scriptText ?? ""
  ).trim().length > 0);
  const scriptPhaseComplete = projectScriptPhaseComplete(projectForNavigation?.status);
  const dramaRecovery = useMemo(() => {
    if (project?.sourceType !== "ai_script" || !failedDramaJob || activeTextJob || scriptPhaseComplete) return null;
    if (allEpisodesHaveScripts) {
      return {
        tone: "continue" as const,
        title: "分集正文已就绪",
        hint: "上次任务虽然超时报错，但分集正文已经保存完整。请展开下方「分集剧本」核对内容，确认无误后进入资产库。",
        action: "我知道了",
      };
    }
    if (outline.outlineReady) {
      return {
        tone: "continue" as const,
        title: "分集正文未完成",
        hint: `摘要与 ${outline.characters.length} 位角色已就绪。点击继续会重新生成分集正文，不会改动摘要。`,
        action: "继续生成分集",
      };
    }
    return {
      tone: "restart" as const,
      title: "摘要与人物小传未完成",
      hint: "上次生成在第 1 步中断，重新生成会从头建立摘要与人物小传。",
      action: "重新生成全剧",
    };
  }, [activeTextJob, allEpisodesHaveScripts, failedDramaJob, outline.characters.length, outline.outlineReady, project?.sourceType, scriptPhaseComplete]);

  useEffect(() => {
    if (!projectId || !activeTextJob) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/generation/jobs/${activeTextJob.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("文本智能任务状态读取失败");
        const data = await response.json() as { job?: ProjectGenerationJob };
        if (cancelled || !data.job) return;
        setGenerationJobs((current) => current.map((job) => job.id === data.job!.id ? data.job! : job));
        if (["queued", "running"].includes(data.job.status)) {
          setAnalysisState(textJobMessage(data.job.capability, resolveScriptJobStage(data.job, outline.outlineReady), outline.outlineReady));
          timer = window.setTimeout(poll, 1_500);
          return;
        }
        if (data.job.status === "failed") {
          setError(friendlyGenerationError(data.job.errorMessage || "文本智能任务失败，原始内容已保留，可以安全重试"));
          setAnalysisState("");
          setConfirmingScript(false);
          await loadProject(data.job.capability === "llm_episode" ? data.job.entityId : undefined);
          return;
        }
        const refreshed = await loadProject(data.job.capability === "llm_episode" ? data.job.entityId : undefined);
        setAnalysisState("");
        setConfirmingScript(false);
        if (data.job.capability === "llm_analysis" || projectAssetsReady(refreshed?.project.status)) onNavigate("assets");
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "文本智能任务状态读取失败");
        setAnalysisState("");
        setConfirmingScript(false);
      }
    };
    setAnalysisState(textJobMessage(activeTextJob.capability, activeJobStage, outline.outlineReady));
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [activeJobStage, activeTextJob, loadProject, onNavigate, outline.outlineReady, projectId]);

  const chooseEpisode = (episode: ProjectEpisode) => {
    setSelectedEpisodeId(episode.id);
    setScriptText(episode.scriptText ?? "");
    setSaveState("已保存");
  };

  useEffect(() => {
    if (!projectId || !selectedEpisode || scriptText === (selectedEpisode.scriptText ?? "")) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scriptText, status: "editing" }),
        });
        if (!response.ok) throw new Error("保存失败");
        const data = await response.json() as { episode?: ProjectEpisode };
        if (data.episode) setEpisodes((current) => current.map((episode) => episode.id === data.episode!.id ? data.episode! : episode));
        setSaveState("已保存");
      } catch {
        setSaveState("保存失败");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, scriptText, selectedEpisode]);

  const ideaDraftRef = useRef(ideaDraft);
  const projectRef = useRef(project);
  useEffect(() => { ideaDraftRef.current = ideaDraft; }, [ideaDraft]);
  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    if (!projectId || project?.sourceType !== "ai_script") return;
    if (!ideaDraft.trim() && project.synopsis?.trim()) return;
    if (ideaDraft === (project.synopsis ?? "")) return;
    const timer = window.setTimeout(async () => {
      setIdeaSaveState("保存中");
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ synopsis: ideaDraft }),
        });
        if (!response.ok) throw new Error("保存失败");
        const data = await response.json() as { project?: ProjectSummary };
        if (data.project) setProject(data.project);
        setIdeaSaveState("已保存");
      } catch {
        setIdeaSaveState("保存失败");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ideaDraft, project?.sourceType, project?.synopsis, projectId]);

  useEffect(() => () => {
    const currentProject = projectRef.current;
    const draft = ideaDraftRef.current.trim();
    if (!projectId || currentProject?.sourceType !== "ai_script" || draft === (currentProject.synopsis ?? "").trim()) return;
    if (!draft && currentProject.synopsis?.trim()) return;
    void fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ synopsis: draft }),
      keepalive: true,
    });
  }, [projectId]);

  const confirmScript = async () => {
    if (!projectId || !selectedEpisode || scriptAnalysisBusy) return;
    if (projectAssetsReady(project?.status)) {
      onNavigate("assets");
      return;
    }
    setConfirmingScript(true);
    setSaveState("保存中");
    setAnalysisState("正在保存当前剧本…");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptText, status: "confirmed" }),
      });
      if (!response.ok) throw new Error("剧本确认失败");
      setEpisodes((current) => current.map((episode) => ({ ...episode, ...(episode.id === selectedEpisode.id ? { scriptText } : {}), status: "confirmed" })));
      if (activeAnalysisJob) {
        setAnalysisState(textJobMessage("llm_analysis", activeJobStage, outline.outlineReady));
        setSaveState("已保存");
        setConfirmingScript(false);
        return;
      }
      setAnalysisState("文本智能正在研读全剧，并生成资产清单、片段与分镜草案…");
      const extraction = await fetch(`/api/projects/${projectId}/extract-assets`, { method: "POST" });
      if (!extraction.ok) {
        const data = await extraction.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "角色与场景提取失败");
      }
      const extractionData = await extraction.json() as { job?: ProjectGenerationJob };
      if (!extractionData.job) throw new Error("剧本理解任务未能建立");
      setGenerationJobs((current) => [extractionData.job!, ...current.filter((job) => job.id !== extractionData.job!.id)]);
      setSaveState("已保存");
      setConfirmingScript(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本确认失败");
      setSaveState("保存失败");
      setAnalysisState("");
      setConfirmingScript(false);
    }
  };

  const addEpisode = async () => {
    if (!projectId || addingEpisode) return;
    setAddingEpisode(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json() as { episode?: ProjectEpisode; error?: { message?: string } };
      if (!response.ok || !data.episode) throw new Error(data.error?.message ?? "新增分集失败");
      setEpisodes((current) => [...current, data.episode!].sort((a, b) => a.episodeNumber - b.episodeNumber));
      chooseEpisode(data.episode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新增分集失败");
    } finally {
      setAddingEpisode(false);
    }
  };

  const regenerateEpisode = async () => {
    if (!projectId || !selectedEpisode || regenerating || saveState === "保存中") return;
    if (selectedEpisode.scriptText && !window.confirm("重新生成会替换当前分集剧本。确定继续吗？")) return;
    setRegenerating(true);
    setError("");
    setAnalysisState(`文本智能正在${selectedEpisode.scriptText ? "重写" : "创作"}第 ${selectedEpisode.episodeNumber} 集…`);
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${selectedEpisode.id}/regenerate`, { method: "POST" });
      const data = await response.json() as { job?: ProjectGenerationJob; error?: { message?: string } };
      if (!response.ok || !data.job) throw new Error(data.error?.message ?? "分集生成任务未能建立");
      setGenerationJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setSaveState("已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分集生成失败");
    } finally {
      setRegenerating(false);
      setAnalysisState("");
    }
  };

  const retryDramaGeneration = async (mode: "full" | "episodes_only" | "outline_only" = "full") => {
    if (!projectId || retryingDrama || activeTextJob) return;
    if (mode === "episodes_only" && episodes.some((episode) => (episode.id === selectedEpisode?.id ? scriptText : episode.scriptText ?? "").trim()) && !window.confirm("将替换全部分集正文，摘要与人物小传保持不变。确定继续吗？")) return;
    setRetryingDrama(true);
    setError("");
    setAnalysisState(
      mode === "outline_only"
        ? "第 1 步：正在根据创意生成剧本摘要与人物小传…"
        : mode === "episodes_only"
          ? "第 2 步：正在依据摘要与人物小传写入分集正文…"
          : "文本智能正在按原来的创意和集数重新生成全剧…",
    );
    try {
      const response = await fetch(`/api/projects/${projectId}/generate-script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json() as { job?: ProjectGenerationJob; error?: { message?: string } };
      if (!response.ok || !data.job) throw new Error(data.error?.message ?? "全剧生成任务未能重新建立");
      setGenerationJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setProject((current) => current ? { ...current, status: "script_generating" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全剧重新生成失败");
      setAnalysisState("");
    } finally {
      setRetryingDrama(false);
    }
  };

  const retryUploadedScriptStructuring = async () => {
    if (!projectId || retryingDrama || activeTextJob) return;
    setRetryingDrama(true);
    setError("");
    setAnalysisState("文本智能正在从已保存的原始完整剧本重新整理分集…");
    try {
      const response = await fetch(`/api/projects/${projectId}/structure-script`, { method: "POST" });
      const data = await response.json() as { job?: ProjectGenerationJob; error?: { message?: string } };
      if (!response.ok || !data.job) throw new Error(data.error?.message ?? "分集整理任务未能重新建立");
      setGenerationJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setProject((current) => current ? { ...current, status: "script_structuring" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重新整理分集失败");
      setAnalysisState("");
    } finally {
      setRetryingDrama(false);
    }
  };

  if (!projectId) {
    return (
      <StudioShell view="script" onNavigate={onNavigate}>
        <div className="missing-project"><b>还没有选择短剧项目</b><p>请从“我的短剧”打开一个项目，或先创建新项目。</p><AppButton primary onClick={() => onNavigate("drama")}>返回我的短剧</AppButton></div>
      </StudioShell>
    );
  }

  return (
    <StudioShell view="script" onNavigate={onNavigate}>
      <ProjectTop step={1} project={projectForNavigation} onNavigate={onNavigate} title={project?.title} stylePreset={project?.stylePreset} aspectRatio={project?.aspectRatio} saveState={saveState} />
      <div className="project-body script-outline-body">
        <main className="script-outline-workspace">
          {loading ? (
            <div className="script-loading">正在读取剧本大纲…</div>
          ) : error && !project ? (
            <div className="script-loading error">{error}</div>
          ) : (
            <>
              <header className="script-outline-header">
                <div><h2>共 {outline.plannedEpisodeCount} 集</h2><p>当前已经生成 {outline.readyEpisodeCount} 集 · 待生成 {outline.pendingEpisodeCount} 集</p></div>
                <span className={`script-outline-phase ${outline.generationPhase}`}>
                  {outline.generationPhase === "generating"
                    ? outline.generationStep === "outline"
                      ? "生成摘要中"
                      : outline.generationStep === "episodes"
                        ? "写入分集中"
                        : "生成中"
                    : outline.generationPhase === "failed"
                      ? "待恢复"
                      : scriptPhaseComplete
                        ? "已进入资产库"
                        : outline.outlineReady && outline.readyEpisodeCount >= outline.plannedEpisodeCount
                          ? "大纲就绪"
                          : outline.outlineReady
                            ? "摘要已就绪"
                            : "待生成"}
                </span>
              </header>

              {analysisState && <div className={`script-analysis-state${activeAnalysisJob ? " asset-extraction" : ""}`} role="status"><i /><div><b>{analysisState}</b><span>{textJobHint(activeTextJob?.capability ?? (activeAnalysisJob ? "llm_analysis" : ""), activeJobStage, outline.outlineReady)}</span></div></div>}
              {error && <p className="project-form-error" role="alert">{friendlyGenerationError(error)}</p>}
              {scriptPhaseComplete && (
                <div className="script-recovery-card ready">
                  <div><b>已有剧本与资产已保留</b><span>{`${outline.readyEpisodeCount}/${outline.plannedEpisodeCount} 集正文已保存，已有资产库可继续查看和演示。`}</span></div>
                  <AppButton primary onClick={() => onNavigate("assets")}>返回资产库 →</AppButton>
                </div>
              )}
              {dramaRecovery && outline.wizardStep !== "outline_review" && !scriptPhaseComplete && (
                <div className={`script-recovery-card ${dramaRecovery.tone}${allEpisodesHaveScripts ? " ready" : ""}`}>
                  <div><b>{dramaRecovery.title}</b><span>{dramaRecovery.hint}</span></div>
                  <AppButton disabled={retryingDrama} onClick={() => {
                    if (allEpisodesHaveScripts) {
                      setError("");
                      return;
                    }
                    void retryDramaGeneration(dramaRecovery.tone === "continue" ? "episodes_only" : "full");
                  }}>{retryingDrama ? "正在重新提交…" : dramaRecovery.action}</AppButton>
                </div>
              )}
              {project?.sourceType === "upload" && failedStructureJob && !activeTextJob && (
                <div className="script-recovery-card">
                  <div><b>完整剧本还没有整理成分集</b><span>上传的原稿仍完整保存在项目中，可以重新建立整理任务，不需要再次上传。</span></div>
                  <AppButton disabled={retryingDrama} onClick={() => void retryUploadedScriptStructuring()}>{retryingDrama ? "正在重新提交…" : "重新整理分集"}</AppButton>
                </div>
              )}

              {project?.sourceType === "upload" ? (
                <>
                  <details className="script-outline-section" open>
                    <summary><span>原始创意</span><b>完整原稿</b></summary>
                    <pre className="script-outline-source">{project.sourceText || "这个旧项目创建时尚未保存原始剧本；当前分集剧本不受影响。"}</pre>
                  </details>
                  <details className="script-outline-section" open>
                    <summary><span>分集剧本</span><b>{`${outline.readyEpisodeCount}/${episodes.length || outline.plannedEpisodeCount} 集已有正文`}</b></summary>
                    <div className="script-episode-switcher">
                      {episodes.map((episode) => {
                        const ready = Boolean((episode.id === selectedEpisode?.id ? scriptText : episode.scriptText)?.trim());
                        return <button key={episode.id} type="button" className={selectedEpisode?.id === episode.id ? "active" : ""} onClick={() => chooseEpisode(episode)}>
                          <span>{String(episode.episodeNumber).padStart(2, "0")}</span>
                          <div><b>{episode.title}</b><small>{episode.summary || "摘要待生成"}</small></div>
                          <i className={ready ? "ready" : "pending"}>{ready ? "已有正文" : "待生成"}</i>
                        </button>;
                      })}
                    </div>
                    {selectedEpisode && (
                      <div className="episode-script editor-mode">
                        <textarea className="script-text-editor" aria-label="分集剧本内容" value={scriptText} onChange={(event) => { setScriptText(event.target.value); setSaveState("保存中"); }} placeholder="在这里粘贴或编写本集剧本…" />
                      </div>
                    )}
                  </details>
                  <div className="script-footer">
                    <AppButton primary disabled={!allEpisodesHaveScripts || saveState === "保存中" || scriptAnalysisBusy} onClick={confirmScript}>{scriptAnalysisBusy ? "正在理解完整剧本…" : "确认全剧剧本，进入资产库 →"}</AppButton>
                  </div>
                </>
              ) : (
                <>
              <div className="script-outline-steps" aria-label="剧本生成顺序">
                <span className={outline.outlineReady ? "done" : outline.wizardStep === "idea" ? "active" : ""}>1. 剧本摘要与人物小传</span>
                <span className={allEpisodesHaveScripts && outline.outlineReady ? "done" : outline.wizardStep === "episodes" ? "active" : ""}>2. 分集剧本正文</span>
                <span className={outline.wizardStep === "confirm" ? "active" : ""}>3. 确认并进入资产库</span>
              </div>

              {outline.wizardStep === "idea" && (
                <div className="script-wizard-panel">
                  <p className="script-wizard-lead">先写清楚短剧创意。确认后，小飞象只会生成<strong>剧本摘要与人物小传</strong>，不会直接写分集正文。</p>
                  <details className="script-outline-section" open>
                    <summary><span>原始创意</span><b>{ideaSaveState}</b></summary>
                    <textarea className="script-outline-idea" value={ideaDraft} onChange={(event) => { setIdeaDraft(event.target.value); setIdeaSaveState("保存中"); }} placeholder="描述题材、主角、爽点、集数预期…" />
                  </details>
                  <div className="script-wizard-actions">
                    <AppButton primary disabled={!ideaDraft.trim() || ideaSaveState === "保存中" || retryingDrama || Boolean(activeTextJob)} onClick={() => void retryDramaGeneration("outline_only")}>
                      {activeTextJob || retryingDrama ? "正在生成摘要…" : outline.outlineReady ? "重新生成摘要" : "生成剧本摘要与人物小传"}
                    </AppButton>
                  </div>
                </div>
              )}

              {outline.wizardStep === "outline_review" && (
                <div className="script-wizard-panel">
                  <p className="script-wizard-lead">请核对摘要与人物小传。确认无误后，再进入第 2 步生成分集正文。</p>
                  <details className="script-outline-section" open>
                    <summary><span>原始创意</span><b>{ideaSaveState}</b></summary>
                    <textarea className="script-outline-idea" value={ideaDraft} onChange={(event) => { setIdeaDraft(event.target.value); setIdeaSaveState("保存中"); }} placeholder="描述你的短剧创意、题材和爽点…" />
                  </details>
                  <details className="script-outline-section" open>
                    <summary><span>剧本摘要</span><b>{`${outline.characters.length} 位角色 · 待你确认`}</b></summary>
                    <ScriptOutlineSummaryBody outline={outline} />
                  </details>
                  <div className="script-wizard-actions">
                    <AppButton disabled={retryingDrama || Boolean(activeTextJob)} onClick={() => void retryDramaGeneration("outline_only")}>重新生成摘要</AppButton>
                    <AppButton primary disabled={retryingDrama || Boolean(activeTextJob)} onClick={() => void retryDramaGeneration("episodes_only")}>确认摘要，生成分集正文 →</AppButton>
                  </div>
                </div>
              )}

              {(outline.wizardStep === "episodes" || outline.wizardStep === "confirm") && (
                <>
              <details className="script-outline-section" open={outline.wizardStep === "confirm"}>
                <summary><span>原始创意</span><b>{ideaSaveState}</b></summary>
                <textarea className="script-outline-idea" value={ideaDraft} readOnly />
              </details>

              <details className="script-outline-section">
                <summary><span>剧本摘要</span><b>{`${outline.characters.length} 位角色 · 已确认`}</b></summary>
                <ScriptOutlineSummaryBody outline={outline} />
              </details>

              <details className="script-outline-section" open>
                <summary><span>分集剧本</span><b>{`${outline.readyEpisodeCount}/${episodes.length || outline.plannedEpisodeCount} 集已有正文`}</b></summary>
                <div className="script-episode-batch-actions">
                  <div><b>分集与人物不一致？</b><span>摘要与人物小传已锁定时，可以一次性重写全部分集正文，不会改动上方摘要。</span></div>
                  <AppButton disabled={retryingDrama || Boolean(activeTextJob) || Boolean(analysisState)} onClick={() => void retryDramaGeneration("episodes_only")}>{retryingDrama || activeTextJob?.capability === "llm_script" ? "正在生成…" : "重新生成全部分集"}</AppButton>
                </div>
                <div className="script-episode-switcher">
                  {episodes.map((episode) => {
                    const ready = Boolean((episode.id === selectedEpisode?.id ? scriptText : episode.scriptText)?.trim());
                    return <button key={episode.id} type="button" className={selectedEpisode?.id === episode.id ? "active" : ""} onClick={() => chooseEpisode(episode)}>
                      <span>{String(episode.episodeNumber).padStart(2, "0")}</span>
                      <div><b>{episode.title}</b><small>{episode.summary || "摘要待生成"}</small></div>
                      <i className={ready ? "ready" : "pending"}>{ready ? "已有正文" : "待生成"}</i>
                    </button>;
                  })}
                  <button type="button" className="add-episode-inline" disabled={addingEpisode} onClick={() => void addEpisode()}>{addingEpisode ? "正在新增…" : "＋ 新增一集"}</button>
                </div>
                {selectedEpisode ? (
                  <div className="episode-script editor-mode">
                    <div className="workspace-header compact">
                      <div><p className="eyebrow">第 {selectedEpisode.episodeNumber} 集</p><h3>{selectedEpisode.title}</h3></div>
                      <div><span className={`autosave-state ${saveState === "保存失败" ? "error" : ""}`}>{saveState}</span><AppButton disabled={regenerating || saveState === "保存中" || Boolean(analysisState)} onClick={() => void regenerateEpisode()}>{regenerating || activeTextJob?.capability === "llm_episode" ? "正在生成…" : selectedEpisode.scriptText ? "重新生成本集" : "AI 生成本集"}</AppButton></div>
                    </div>
                    {selectedEpisode.status === "confirmed" && <div className="lock-banner"><span>✓</span><div><b>本集剧本已确认</b><p>继续修改会自动保存，进入资产提取时以最新内容为准。</p></div></div>}
                    <textarea
                      className="script-text-editor"
                      aria-label="分集剧本内容"
                      value={scriptText}
                      onChange={(event) => { setScriptText(event.target.value); setSaveState("保存中"); }}
                      placeholder="文本智能生成的分集剧本会保存在这里；你也可以直接继续创作。"
                    />
                    <div className="script-count">{scriptText.length.toLocaleString()} 字</div>
                  </div>
                ) : <p className="script-outline-empty">还没有分集记录，请先完成分集生成。</p>}
              </details>
                </>
              )}

              {outline.wizardStep !== "idea" && outline.wizardStep !== "outline_review" && (
              <div className="script-footer">
                <div><span className="status-dot" />{scriptPhaseComplete ? "剧本已锁定，可返回资产库继续制作" : allEpisodesHaveScripts ? "全部分集正文已就绪，可进入资产库" : "请先完成第 2 步：分集剧本正文"}</div>
                <AppButton primary disabled={scriptPhaseComplete ? false : !allEpisodesHaveScripts || !outline.outlineReady || saveState === "保存中" || scriptAnalysisBusy} onClick={scriptPhaseComplete ? () => onNavigate("assets") : confirmScript}>{scriptPhaseComplete ? "返回资产库 →" : scriptAnalysisBusy ? "正在理解完整剧本…" : "确认全剧剧本，进入资产库 →"}</AppButton>
              </div>
              )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </StudioShell>
  );
}
