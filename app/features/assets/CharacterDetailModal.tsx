"use client";

import { useEffect, useMemo, useState } from "react";
import { AppButton } from "../../components/ui";
import { useSettings } from "../settings/SettingsProvider";
import { describeGenerationError } from "../../lib/generation-errors";
import { visualAssetApproved } from "../../lib/visual-asset-approval";
import { buildCharacterVisualPrompt, readCharacterProfileDescription } from "../../lib/character-profile";
import {
  buildFormVisualPrompt,
  characterConceptJobCapabilities,
  characterPackJobCapabilities,
  isBaseCharacterForm,
  pickBaseCharacterForm,
  resolveCharacterConceptCapability,
  resolveCharacterPackCapability,
} from "../../lib/character-visual-generation";
import type { CharacterForm, CharacterFormReference, ProjectAsset, ProjectCharacter, ProjectGenerationJob, ProjectSummary } from "../studio/types";

type JobProgress = { overall?: number; stage?: string; currentNodeTitle?: string; nodeValue?: number; nodeMax?: number };

const ACTIVE_GENERATION_STATUSES = ["submitting", "queued", "running"] as const;
const REFERENCE_TYPE_LABEL: Record<string, string> = {
  primary: "主标准图",
  front: "正面",
  side: "侧面",
  back: "背面",
  expression: "表情",
  pose: "姿势",
  detail: "细节",
  reference: "补充参考",
};

function formEpisodeLabel(episodeScopeJson: string) {
  try {
    const values = JSON.parse(episodeScopeJson) as unknown;
    return Array.isArray(values) && values.length ? values.map((value) => `第${value}集`).join("、") : "全剧";
  } catch {
    return "全剧";
  }
}

function assetMediaType(asset: ProjectAsset): "image" | "video" | "audio" | "text" | "file" {
  try {
    const mediaType = (JSON.parse(asset.metadataJson) as { mediaType?: unknown }).mediaType;
    if (mediaType === "image" || mediaType === "video" || mediaType === "audio" || mediaType === "text") return mediaType;
  } catch {
    // ignore
  }
  if (asset.assetType.includes("audio") || asset.assetType.includes("voice")) return "audio";
  return "image";
}

function visualAssetReady(asset: ProjectAsset | null | undefined) {
  return Boolean(asset?.thumbnailUrl && asset.status === "ready" && visualAssetApproved(asset.metadataJson));
}

export function CharacterDetailModal({
  projectId,
  project,
  character,
  forms,
  formReferences,
  allAssets,
  onGenerated,
  onClose,
  onSaved,
}: {
  projectId: string;
  project: ProjectSummary;
  character: ProjectCharacter;
  forms: CharacterForm[];
  formReferences: CharacterFormReference[];
  allAssets: ProjectAsset[];
  onGenerated: () => void;
  onClose: () => void;
  onSaved: (character: ProjectCharacter) => void;
}) {
  const { openSettings } = useSettings();
  const orderedForms = useMemo(() => {
    const base = pickBaseCharacterForm(forms);
    if (!base) return forms;
    return [base, ...forms.filter((form) => form.id !== base.id)];
  }, [forms]);
  const [selectedFormId, setSelectedFormId] = useState(() => orderedForms[0]?.id ?? "");
  const selectedForm = orderedForms.find((form) => form.id === selectedFormId) ?? orderedForms[0] ?? null;

  const audioAssets = allAssets.filter((item) => assetMediaType(item) === "audio");
  const initialVoiceAsset = allAssets.find((item) => item.id === character.voiceAssetId) ?? null;
  const [voiceMode, setVoiceMode] = useState<"文本音色" | "参考音频">(character.voiceAssetId ? "参考音频" : "文本音色");
  const [voiceAssetId, setVoiceAssetId] = useState(character.voiceAssetId);
  const [voiceAssetUrl, setVoiceAssetUrl] = useState(initialVoiceAsset?.thumbnailUrl ?? null);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [name, setName] = useState(character.canonicalName);
  const [description, setDescription] = useState(character.voiceDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const characterProfileDescription = readCharacterProfileDescription(character.profileJson);
  const [visualPrompt, setVisualPrompt] = useState(() =>
    selectedForm
      ? buildFormVisualPrompt({
          characterName: character.canonicalName,
          characterDescription: characterProfileDescription,
          formName: selectedForm.name,
          formDescription: selectedForm.description,
        })
      : buildCharacterVisualPrompt(character.canonicalName, character.profileJson),
  );
  const [uploadingConcept, setUploadingConcept] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingPackJobIds, setPendingPackJobIds] = useState<string[]>([]);
  const [activeJobFormId, setActiveJobFormId] = useState<string | null>(null);
  const [activeJobKind, setActiveJobKind] = useState<"concept" | "pack" | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [generationMessage, setGenerationMessage] = useState("");
  const [lockingAssetId, setLockingAssetId] = useState<string | null>(null);

  const selectedPack = useMemo(
    () => formReferences
      .filter((reference) => reference.characterFormId === selectedForm?.id)
      .map((reference) => ({ reference, asset: allAssets.find((item) => item.id === reference.assetId) }))
      .filter((item) => item.asset?.thumbnailUrl),
    [allAssets, formReferences, selectedForm?.id],
  );
  const selectedConcept = selectedForm?.assetId
    ? allAssets.find((item) => item.id === selectedForm.assetId && item.storageKey && item.status === "ready") ?? null
    : null;
  const selectedPreviewUrl = selectedPack[0]?.asset?.thumbnailUrl ?? selectedConcept?.thumbnailUrl ?? null;
  const conceptLocked = visualAssetReady(selectedConcept);
  const packCount = selectedPack.length;
  const formReadyCount = orderedForms.filter((form) => formReferences.some((reference) => reference.characterFormId === form.id)).length;

  useEffect(() => {
    if (!orderedForms.some((form) => form.id === selectedFormId) && orderedForms[0]) {
      setSelectedFormId(orderedForms[0].id);
    }
  }, [orderedForms, selectedFormId]);

  useEffect(() => {
    if (!selectedForm) return;
    setVisualPrompt(buildFormVisualPrompt({
      characterName: character.canonicalName,
      characterDescription: characterProfileDescription,
      formName: selectedForm.name,
      formDescription: selectedForm.description,
    }));
    setGenerationMessage("");
    setError("");
  }, [character.canonicalName, characterProfileDescription, selectedForm]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/generation/jobs?projectId=${projectId}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = await response.json() as { jobs?: ProjectGenerationJob[] };
        const activeFormJob = data.jobs?.find((job) =>
          job.entityType === "character_form"
          && orderedForms.some((form) => form.id === job.entityId)
          && (
            characterConceptJobCapabilities().includes(job.capability as "image_generation")
            || characterPackJobCapabilities().includes(job.capability as "character_image")
          )
          && ACTIVE_GENERATION_STATUSES.includes(job.status as (typeof ACTIVE_GENERATION_STATUSES)[number]),
        ) ?? null;
        if (activeFormJob) {
          setJobId(activeFormJob.id);
          setActiveJobFormId(activeFormJob.entityId);
          setActiveJobKind(activeFormJob.capability === "character_image" ? "pack" : "concept");
          setSelectedFormId(activeFormJob.entityId);
          setGenerationMessage("已恢复进行中的生成任务");
        }
      } catch {
        // keep cached snapshot
      }
    })();
    return () => { cancelled = true; };
  }, [orderedForms, projectId]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const ids = pendingPackJobIds.length ? pendingPackJobIds : [jobId];
      const results = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/generation/jobs/${id}`, { cache: "no-store" });
        return response.json() as Promise<{ job?: { id: string; status: string; errorMessage?: string; progress?: JobProgress; entityId?: string } }>;
      }));
      if (cancelled) return;
      const jobs = results.map((item) => item.job).filter(Boolean) as Array<{ id: string; status: string; errorMessage?: string; progress?: JobProgress; entityId?: string }>;
      if (!jobs.length) return;
      const active = jobs.find((job) => ["queued", "running", "submitting"].includes(job.status));
      const failed = jobs.find((job) => job.status === "failed");
      const allDone = jobs.every((job) => !["queued", "running", "submitting"].includes(job.status));
      if (active) {
        setProgress(active.progress ?? { overall: Math.max(8, Math.round((jobs.filter((job) => job.status === "succeeded").length / jobs.length) * 90)), stage: `标准图包进行中 ${jobs.filter((job) => job.status === "succeeded").length}/${jobs.length}` });
        setGenerationMessage(active.progress?.stage ?? `正在生成标准图包（${jobs.filter((job) => job.status === "succeeded").length}/${jobs.length}）`);
        timer = window.setTimeout(poll, 1600);
        return;
      }
      const kind = activeJobKind;
      setJobId(null);
      setPendingPackJobIds([]);
      setActiveJobFormId(null);
      setActiveJobKind(null);
      if (failed) {
        setProgress(null);
        setGenerationMessage(`生成失败：${describeGenerationError(failed.errorMessage ?? "请检查工作流")}`);
        onGenerated();
        return;
      }
      if (allDone) {
        setProgress({ overall: 100, stage: kind === "concept" ? "概念图已生成" : "标准图包已生成" });
        setGenerationMessage(kind === "concept"
          ? "概念图已生成。可为其他形态继续上传，然后点一次「保存并生成三视图」给所有待出图包的形态排队"
          : jobs.length > 1
            ? `已完成 ${jobs.length} 个形态的标准图包，可在左侧切换查看并确认`
            : "标准图包已生成，确认后可用于分镜");
        onGenerated();
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeJobKind, jobId, onGenerated, pendingPackJobIds]);

  const busy = saving || uploadingConcept || uploadingVoice || Boolean(jobId) || Boolean(lockingAssetId);

  const generateConcept = async () => {
    if (!selectedForm) return;
    setError("");
    setActiveJobFormId(selectedForm.id);
    setActiveJobKind("concept");
    setProgress({ overall: 2, stage: "正在提交文生图" });
    setGenerationMessage(`正在为「${selectedForm.name}」生成概念图…`);
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        entityType: "character_form",
        entityId: selectedForm.id,
        capability: resolveCharacterConceptCapability(),
        payload: { prompt: visualPrompt, aspectRatio: project.aspectRatio, stylePreset: project.stylePreset },
      }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string; details?: { reason?: string } } };
    if (!response.ok || !data.job?.id) {
      setProgress(null);
      setActiveJobFormId(null);
      setActiveJobKind(null);
      setGenerationMessage(`生成失败：${describeGenerationError(typeof data.error?.details?.reason === "string" ? data.error.details.reason : data.error?.message ?? "概念图提交失败")}`);
      return;
    }
    setJobId(data.job.id);
  };

  const formConceptEntries = useMemo(() => orderedForms.map((form) => {
    const concept = form.assetId
      ? allAssets.find((item) => item.id === form.assetId && item.storageKey && item.status === "ready") ?? null
      : null;
    const packReady = formReferences.some((reference) => reference.characterFormId === form.id && allAssets.some((item) => item.id === reference.assetId && item.thumbnailUrl));
    return { form, concept, packReady };
  }), [allAssets, formReferences, orderedForms]);
  const formsReadyForPack = formConceptEntries.filter((item) => item.concept && !item.packReady);
  const formsWithUnlockedConcept = formConceptEntries.filter((item) => item.concept && !visualAssetReady(item.concept));

  const submitPackJob = async (form: CharacterForm, referenceAssetId: string, prompt: string) => {
    const capability = resolveCharacterPackCapability(true);
    if (!capability) return null;
    const response = await fetch("/api/generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        entityType: "character_form",
        entityId: form.id,
        capability,
        payload: {
          prompt,
          aspectRatio: project.aspectRatio,
          stylePreset: project.stylePreset,
          referenceImageAssetId: referenceAssetId,
        },
      }),
    });
    const data = await response.json() as { job?: { id: string }; error?: { message?: string; details?: { reason?: string } } };
    if (!response.ok || !data.job?.id) {
      throw new Error(describeGenerationError(typeof data.error?.details?.reason === "string" ? data.error.details.reason : data.error?.message ?? `「${form.name}」标准图包提交失败`));
    }
    return data.job.id;
  };

  const uploadConcept = async (file: File | undefined) => {
    if (!file || !selectedForm) return;
    setUploadingConcept(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const uploadResponse = await fetch(`/api/projects/${projectId}/assets/upload`, { method: "POST", body: formData });
      const uploadData = await uploadResponse.json() as { asset?: ProjectAsset; mediaType?: string; error?: { message?: string } };
      if (!uploadResponse.ok || !uploadData.asset || uploadData.mediaType !== "image") throw new Error(uploadData.error?.message ?? "请选择有效图片");
      const bindResponse = await fetch(`/api/projects/${projectId}/characters/${character.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: uploadData.asset.id, formId: selectedForm.id }),
      });
      const bindData = await bindResponse.json() as { error?: { message?: string } };
      if (!bindResponse.ok) throw new Error(bindData.error?.message ?? "概念图绑定失败");
      setGenerationMessage(`已上传到「${selectedForm.name}」。各形态概念图备齐后，点一次「保存并生成三视图」即可全部出图包`);
      onGenerated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "概念图上传失败");
    } finally {
      setUploadingConcept(false);
    }
  };

  const persistVoiceAndName = async () => {
    const hasVoice = Boolean(description.trim()) || (voiceMode === "参考音频" && Boolean(voiceAssetId));
    const response = await fetch(`/api/projects/${projectId}/characters/${character.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canonicalName: name,
        ...(hasVoice ? {
          voiceDescription: description,
          voiceAssetId: voiceMode === "参考音频" ? voiceAssetId : null,
          voiceLocked: true,
        } : {}),
      }),
    });
    const data = await response.json() as { character?: ProjectCharacter; error?: { message?: string } };
    if (!response.ok || !data.character) throw new Error(data.error?.message ?? "角色保存失败");
    onSaved(data.character);
  };

  const persistConceptLock = async (assetId: string) => {
    const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visualLocked: true }),
    });
    const data = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? "概念图锁定失败");
  };

  const lockAllFormConcepts = async () => {
    for (const item of formsWithUnlockedConcept) {
      if (item.concept) await persistConceptLock(item.concept.id);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await persistVoiceAndName();
      await lockAllFormConcepts();
      setGenerationMessage(formsReadyForPack.length
        ? `已保存。当前有 ${formsReadyForPack.length} 个形态已有概念图、待出三视图，点一次即可全部生成`
        : "已保存角色与各形态概念图");
      onGenerated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveAndGenerateThreeView = async () => {
    if (!orderedForms.length) return setError("当前角色还没有形态，请先重新提取资产");
    const targets = formsReadyForPack.length
      ? formsReadyForPack
      : selectedConcept && selectedForm
        ? [{ form: selectedForm, concept: selectedConcept, packReady: packCount > 0 }]
        : [];
    if (!targets.length || !targets[0]?.concept) {
      return setError("请先为至少一个形态文生图或上传概念图");
    }
    setSaving(true);
    setError("");
    try {
      await persistVoiceAndName();
      await lockAllFormConcepts();
      for (const item of targets) {
        if (item.concept && !visualAssetReady(item.concept)) await persistConceptLock(item.concept.id);
      }
      onGenerated();
      const names = targets.map((item) => item.form.name);
      setActiveJobKind("pack");
      setProgress({ overall: 4, stage: `正在为 ${targets.length} 个形态提交标准图包` });
      setGenerationMessage(`正在提交：${names.join("、")}`);
      const jobIds: string[] = [];
      for (const item of targets) {
        const prompt = item.form.id === selectedForm?.id
          ? visualPrompt
          : buildFormVisualPrompt({
              characterName: name || character.canonicalName,
              characterDescription: characterProfileDescription,
              formName: item.form.name,
              formDescription: item.form.description,
            });
        const jobIdNext = await submitPackJob(item.form, item.concept!.id, prompt);
        if (jobIdNext) jobIds.push(jobIdNext);
      }
      if (!jobIds.length) throw new Error("没有成功提交任何标准图包任务");
      setActiveJobFormId(targets[0].form.id);
      setJobId(jobIds[0]);
      setPendingPackJobIds(jobIds);
      setGenerationMessage(targets.length > 1
        ? `已为 ${targets.length} 个形态提交三视图任务：${names.join("、")}`
        : `已提交「${names[0]}」三视图任务`);
    } catch (reason) {
      setProgress(null);
      setActiveJobFormId(null);
      setActiveJobKind(null);
      setError(reason instanceof Error ? reason.message : "保存并生成三视图失败");
      setGenerationMessage(reason instanceof Error ? `生成失败：${reason.message}` : "生成失败");
    } finally {
      setSaving(false);
    }
  };

  const confirmPack = async (assetId: string) => {
    setLockingAssetId(assetId);
    setError("");
    try {
      await persistConceptLock(assetId);
      setGenerationMessage(`「${selectedForm?.name ?? "当前形态"}」标准图包已确认锁定`);
      onGenerated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "锁定失败");
    } finally {
      setLockingAssetId(null);
    }
  };

  const uploadVoice = async (file: File | undefined) => {
    if (!file) return;
    setUploadingVoice(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/projects/${projectId}/assets/upload`, { method: "POST", body: formData });
      const data = await response.json() as { asset?: ProjectAsset; mediaType?: string; error?: { message?: string } };
      if (!response.ok || !data.asset || data.mediaType !== "audio") throw new Error(data.error?.message ?? "请选择有效音频");
      setVoiceAssetId(data.asset.id);
      setVoiceAssetUrl(data.asset.thumbnailUrl);
      setVoiceMode("参考音频");
      if (!description.trim()) setDescription(`使用参考音频“${data.asset.name}”保持全剧音色一致`);
      onGenerated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "音色上传失败");
    } finally {
      setUploadingVoice(false);
    }
  };

  const statusLabel = packCount > 0
    ? (selectedConcept && visualAssetReady(allAssets.find((item) => item.id === selectedForm?.assetId)) ? "标准图包已就绪" : "标准图包待确认")
    : selectedConcept
      ? (conceptLocked ? "概念图已锁定 · 待出三视图" : "概念图待保存锁定")
      : "尚未有概念图";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="voice-modal character-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">角色详情</p>
            <h2>{name}</h2>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="voice-modal-body character-detail-body">
          <aside className="role-preview-column">
            <div className={`role-preview ${selectedPreviewUrl ? "has-real-asset" : "missing-real-asset"}`} style={selectedPreviewUrl ? { backgroundImage: `url(${selectedPreviewUrl})` } : undefined}>
              <span>{selectedForm ? `${selectedForm.name} · ${statusLabel}` : statusLabel}</span>
            </div>

            {selectedPack.length > 0 && (
              <div className="character-reference-pack">
                <div>
                  <b>{selectedForm?.name ?? "当前形态"} · 标准图包</b>
                  <span>{selectedPack.length} 张</span>
                </div>
                <section>
                  {selectedPack.map(({ reference, asset: packAsset }) => (
                    <article key={reference.id} title={REFERENCE_TYPE_LABEL[reference.referenceType] ?? reference.referenceType}>
                      <i style={{ backgroundImage: `url(${packAsset!.thumbnailUrl})` }} />
                      <small>{REFERENCE_TYPE_LABEL[reference.referenceType] ?? "参考图"}</small>
                    </article>
                  ))}
                </section>
                {selectedForm?.assetId && selectedPack[0]?.asset && !visualAssetReady(allAssets.find((item) => item.id === selectedForm.assetId)) && (
                  <AppButton className="compact" disabled={busy} onClick={() => void confirmPack(selectedForm.assetId!)}>
                    {lockingAssetId === selectedForm.assetId ? "锁定中…" : "确认本形态图包"}
                  </AppButton>
                )}
              </div>
            )}

            <div className="character-form-switcher" role="tablist" aria-label="角色形态">
              <div className="character-form-switcher-head">
                <b>形态</b>
                <span>{formReadyCount}/{orderedForms.length || 1} 已有图包</span>
              </div>
              {orderedForms.length ? orderedForms.map((form) => {
                const count = formReferences.filter((reference) => reference.characterFormId === form.id && allAssets.some((item) => item.id === reference.assetId && item.thumbnailUrl)).length;
                const concept = form.assetId ? allAssets.find((item) => item.id === form.assetId) : null;
                const state = count > 0 ? "已有图包" : concept ? "有概念图" : "待开始";
                return (
                  <button
                    key={form.id}
                    type="button"
                    role="tab"
                    aria-selected={form.id === selectedForm?.id}
                    className={form.id === selectedForm?.id ? "active" : ""}
                    disabled={busy && activeJobFormId !== form.id}
                    onClick={() => setSelectedFormId(form.id)}
                  >
                    <i style={concept?.thumbnailUrl || count ? { backgroundImage: `url(${(count ? allAssets.find((item) => item.id === formReferences.find((reference) => reference.characterFormId === form.id)?.assetId)?.thumbnailUrl : concept?.thumbnailUrl) ?? ""})` } : undefined}>
                      {!concept?.thumbnailUrl && !count ? (isBaseCharacterForm(form) ? "基础" : "形态") : ""}
                    </i>
                    <span>
                      <b>{form.name}</b>
                      <small>{state} · {formEpisodeLabel(form.episodeScopeJson)}</small>
                    </span>
                  </button>
                );
              }) : (
                <p className="character-form-empty">暂无形态，请先重新提取资产</p>
              )}
            </div>
          </aside>

          <div className="role-form">
            <section className="character-modal-section">
              <div className="character-modal-section-head">
                <div>
                  <h3>{selectedForm ? `形态形象 · ${selectedForm.name}` : "形态形象"}</h3>
                  <p>切形态只为编辑概念图；点一次「保存并生成三视图」会给所有已上传概念图、尚未出图包的形态一起排队。</p>
                </div>
                <span className={packCount > 0 ? "saved-state" : "pending-state"}>
                  {packCount > 0 ? "✓ 图包已生成" : selectedConcept ? "待出三视图" : "待概念图"}
                </span>
              </div>
              <p className="character-modal-profile">{selectedForm?.description?.trim() || characterProfileDescription}</p>
              <div className="character-modal-actions">
                <AppButton disabled={busy || !selectedForm || !visualPrompt.trim()} onClick={() => void generateConcept()}>
                  {jobId && activeJobKind === "concept" && activeJobFormId === selectedForm?.id ? "文生图中…" : selectedConcept ? "重新文生图" : "文生图"}
                </AppButton>
                <label className={`app-button upload-button${busy || !selectedForm ? " disabled" : ""}`}>
                  {uploadingConcept ? "上传中…" : "上传概念图"}
                  <input type="file" accept="image/*" disabled={busy || !selectedForm} onChange={(event) => void uploadConcept(event.target.files?.[0])} />
                </label>
              </div>
              <details className="character-prompt-advanced">
                <summary>微调本形态生成要求</summary>
                <textarea value={visualPrompt} onChange={(event) => setVisualPrompt(event.target.value)} placeholder="可按当前形态微调提示词…" />
              </details>
              {progress && (
                <div className="real-generation-progress">
                  <div><span>{progress.stage ?? generationMessage}</span><b>{Math.round(progress.overall ?? 0)}%</b></div>
                  <i><em style={{ width: `${Math.max(2, progress.overall ?? 0)}%` }} /></i>
                  {progress.currentNodeTitle && <small>当前节点：{progress.currentNodeTitle}{progress.nodeMax ? ` · ${progress.nodeValue ?? 0}/${progress.nodeMax}` : ""}</small>}
                </div>
              )}
              {generationMessage && !progress && (
                <p className={`generation-message${generationMessage.startsWith("生成失败") ? " error" : ""}`}>
                  {generationMessage}
                  {generationMessage.startsWith("生成失败") && /WORKFLOW_NOT_VERIFIED|需要先绑定|人物一致性/.test(generationMessage) && (
                    <button type="button" className="inline-settings-link" onClick={() => openSettings("image", activeJobKind === "pack" ? "character_image" : "image_generation")}>
                      打开设置 · {activeJobKind === "pack" ? "人物一致性" : "文生图"}
                    </button>
                  )}
                </p>
              )}
            </section>

            <section className="character-modal-section">
              <div className="character-modal-section-head">
                <div>
                  <h3>固定音色</h3>
                  <p>角色级配置，所有形态共用。分镜生产时走「对白 TTS」。</p>
                </div>
                <span className={character.voiceLocked ? "saved-state" : "pending-state"}>{character.voiceLocked ? "✓ 已锁定" : "待锁定"}</span>
              </div>
              <label>角色名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
              <div className="voice-mode-tabs">
                {(["文本音色", "参考音频"] as const).map((item) => (
                  <button key={item} type="button" className={voiceMode === item ? "active" : ""} onClick={() => setVoiceMode(item)}>{item}</button>
                ))}
              </div>
              {voiceMode === "文本音色" ? (
                <>
                  <textarea className="voice-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：青年男声，低沉内敛…" />
                  <p className="voice-mode-hint">保存后写入角色配置；此处不生成试听。</p>
                </>
              ) : (
                <div className="voice-reference-editor">
                  <label className={`app-button upload-button${uploadingVoice ? " disabled" : ""}`}>
                    {uploadingVoice ? "正在上传…" : "上传参考音频"}
                    <input type="file" accept="audio/*" disabled={uploadingVoice} onChange={(event) => void uploadVoice(event.target.files?.[0])} />
                  </label>
                  {audioAssets.length > 0 && (
                    <label>
                      或选择项目中的音频
                      <select value={voiceAssetId ?? ""} onChange={(event) => {
                        const next = audioAssets.find((item) => item.id === event.target.value) ?? null;
                        setVoiceAssetId(next?.id ?? null);
                        setVoiceAssetUrl(next?.thumbnailUrl ?? null);
                      }}>
                        <option value="">请选择音频</option>
                        {audioAssets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  )}
                  {voiceAssetUrl && <audio controls preload="metadata" src={voiceAssetUrl} />}
                  <textarea className="voice-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选：补充音色说明" />
                </div>
              )}
            </section>
            {error && <p className="modal-error">{error}</p>}
          </div>
        </div>

        <div className="modal-footer">
          <AppButton onClick={onClose}>取消</AppButton>
          <AppButton disabled={busy} onClick={() => void save()}>{saving && !jobId ? "正在保存…" : "保存"}</AppButton>
          <AppButton primary disabled={busy || (formsReadyForPack.length === 0 && !selectedConcept)} onClick={() => void saveAndGenerateThreeView()}>
            {jobId && activeJobKind === "pack"
              ? (pendingPackJobIds.length > 1 ? `三视图生成中 ${pendingPackJobIds.length} 项…` : "三视图生成中…")
              : formsReadyForPack.length > 1
                ? `保存并为 ${formsReadyForPack.length} 个形态生成三视图`
                : formsReadyForPack.length === 1
                  ? `保存并生成三视图 · ${formsReadyForPack[0].form.name}`
                  : packCount > 0
                    ? "保存并重做当前形态三视图"
                    : "保存并生成三视图"}
          </AppButton>
        </div>
      </div>
    </div>
  );
}
