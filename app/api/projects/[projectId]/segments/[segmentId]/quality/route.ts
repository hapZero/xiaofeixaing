import { waitUntil } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { assets, characterFormReferences, dialogueLines, episodes, mediaJobs, segmentVersions, segments, shots } from "../../../../../../../db/schema";
import { errorResponse, json, readJson } from "../../../../../../lib/server/http";
import { getVisionConnection, reviewSegmentContinuity } from "../../../../../../lib/server/llm";
import { recoverInterruptedMediaJobs } from "../../../../../../lib/server/media-job-recovery";
import { sampleVideoContactSheet } from "../../../../../../lib/server/media-worker";
import { getOwnedProject } from "../../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../../lib/server/request-user";
import { loadEffectiveSegmentReferences, referencesForShot } from "../../../../../../lib/server/segment-references";

type RouteContext = { params: Promise<{ projectId: string; segmentId: string }> };
type QualityIssue = { category: string; severity: "warning" | "error"; shotNumbers: number[]; message: string; suggestion: string };
type ReviewBody = { decision?: "approved" | "rejected"; note?: string };
const qualityOperation = "segment_quality_review";

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dataUrl(bytes: ArrayBuffer, contentType: string) {
  const source = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < source.length; offset += 0x8000) binary += String.fromCharCode(...source.subarray(offset, offset + 0x8000));
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function loadContext(projectId: string, segmentId: string) {
  const db = getDb();
  const joined = (await db.select().from(segments).innerJoin(episodes, eq(episodes.id, segments.episodeId)).where(and(eq(segments.id, segmentId), eq(episodes.projectId, projectId))).limit(1))[0];
  if (!joined) return null;
  const version = joined.segments.currentVersionNumber > 0
    ? (await db.select().from(segmentVersions).where(and(eq(segmentVersions.segmentId, segmentId), eq(segmentVersions.versionNumber, joined.segments.currentVersionNumber))).limit(1))[0] ?? null
    : (await db.select().from(segmentVersions).where(eq(segmentVersions.segmentId, segmentId)).orderBy(desc(segmentVersions.versionNumber)).limit(1))[0] ?? null;
  const segmentShots = await db.select().from(shots).where(eq(shots.segmentId, segmentId)).orderBy(shots.sequence);
  const shotIds = segmentShots.map((shot) => shot.id);
  const references = await loadEffectiveSegmentReferences(segmentId, shotIds, joined.segments.referenceMode);
  const formIds = [...new Set(references.flatMap((reference) => reference.characterFormId ? [reference.characterFormId] : []))];
  const formReferences = formIds.length
    ? await db.select().from(characterFormReferences).where(inArray(characterFormReferences.characterFormId, formIds)).orderBy(characterFormReferences.referenceOrder)
    : [];
  const lines = shotIds.length ? await db.select().from(dialogueLines).where(inArray(dialogueLines.shotId, shotIds)).orderBy(dialogueLines.sequence) : [];
  const assetIds = [...new Set([
    ...(version?.resultAssetId ? [version.resultAssetId] : []),
    ...references.flatMap((reference) => reference.assetId ? [reference.assetId] : []),
    ...formReferences.map((reference) => reference.assetId),
  ])];
  const projectAssets = assetIds.length ? await db.select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, assetIds))) : [];
  return { segment: joined.segments, episode: joined.episodes, version, shots: segmentShots, references, formReferences, lines, assets: projectAssets };
}

function structuralReview(context: NonNullable<Awaited<ReturnType<typeof loadContext>>>) {
  const issues: QualityIssue[] = [];
  const assetById = new Map(context.assets.map((asset) => [asset.id, asset]));
  if (!context.version?.resultAssetId || !assetById.get(context.version.resultAssetId)?.storageKey) {
    issues.push({ category: "output", severity: "error", shotNumbers: [], message: "当前片段版本没有可读取的视频文件", suggestion: "重新生成当前片段" });
  }
  context.shots.forEach((shot, index) => {
    const shotNumber = index + 1;
    if (shot.durationMs < 500) issues.push({ category: "duration", severity: "error", shotNumbers: [shotNumber], message: "分镜时长小于 0.5 秒，无法稳定表达动作", suggestion: "延长分镜时长并重新生成" });
    if (shot.prompt.trim().length < 20) issues.push({ category: "shot_coverage", severity: "warning", shotNumbers: [shotNumber], message: "分镜导演描述过短，难以核对动作与画面", suggestion: "补充景别、动作、场景、角色状态和转场" });
    const shotReferences = referencesForShot(context.references, shot.id);
    shotReferences.filter((reference) => reference.required).forEach((reference) => {
      const formAssetIds = reference.characterFormId
        ? context.formReferences.filter((item) => item.characterFormId === reference.characterFormId).map((item) => item.assetId)
        : [];
      const requiredAssetIds = formAssetIds.length ? formAssetIds : reference.assetId ? [reference.assetId] : [];
      const ready = requiredAssetIds.length > 0 && requiredAssetIds.every((assetId) => {
        const asset = assetById.get(assetId);
        return Boolean(asset?.storageKey && asset.status === "ready");
      });
      if (!ready) issues.push({ category: reference.referenceRole, severity: "error", shotNumbers: [shotNumber], message: `必需的${reference.referenceRole}资产没有真实媒体文件`, suggestion: "回到资产库生成并确认对应标准资产" });
    });
  });
  const sceneIds = [...new Set(context.references.filter((reference) => reference.referenceRole === "scene" && reference.assetId).map((reference) => reference.assetId as string))];
  if (sceneIds.length > 1) issues.push({ category: "scene", severity: "warning", shotNumbers: [], message: "同一片段引用了多个场景标准图，需确认是否为计划内转场", suggestion: "若不是转场，请统一场景引用后重做受影响分镜" });
  const formsByCharacter = new Map<string, Set<string>>();
  context.references.forEach((reference) => {
    if (!reference.characterId || !reference.characterFormId) return;
    const forms = formsByCharacter.get(reference.characterId) ?? new Set<string>();
    forms.add(reference.characterFormId);
    formsByCharacter.set(reference.characterId, forms);
  });
  for (const forms of formsByCharacter.values()) if (forms.size > 1) issues.push({ category: "character", severity: "warning", shotNumbers: [], message: "同一角色在片段内引用了多个形态", suggestion: "确认换装或状态变化发生在明确分镜，否则统一角色形态" });
  context.lines.forEach((line) => {
    const delivery = parseObject(line.deliveryJson);
    if (line.lineType === "dialogue" && delivery.mouthOpen === false) issues.push({ category: "action", severity: "warning", shotNumbers: [], message: "角色对白被标记为不张嘴", suggestion: "确认是否为画外对白，否则修正口型指令" });
  });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return { passed: errors === 0, score: Math.max(0, 100 - errors * 25 - warnings * 8), issues };
}

export async function GET(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await routeContext.params;
  if (!await getOwnedProject(projectId, user.id)) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  let context = await loadContext(projectId, segmentId);
  if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  if (context.version) {
    const recovered = await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment_version", entityId: context.version.id, operation: qualityOperation });
    if (recovered.recovered) context = await loadContext(projectId, segmentId) ?? context;
  }
  const jobs = context.version ? await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment_version"),
    eq(mediaJobs.entityId, context.version.id),
    eq(mediaJobs.operation, qualityOperation),
  )).orderBy(desc(mediaJobs.createdAt)).limit(10) : [];
  const activeJob = jobs.find((job) => ["queued", "running"].includes(job.status)) ?? null;
  const latestTerminal = jobs.find((job) => ["succeeded", "failed"].includes(job.status)) ?? null;
  const lastFailure = latestTerminal?.status === "failed" ? latestTerminal : null;
  return json({
    segmentId,
    version: context.version,
    quality: parseObject(context.version?.qualityJson),
    visionConfigured: Boolean(await getVisionConnection(user.id)),
    activeReview: activeJob ? { id: activeJob.id, status: activeJob.status, progress: activeJob.progress } : null,
    lastFailure: !activeJob && lastFailure ? { id: lastFailure.id, errorCode: lastFailure.errorCode, errorMessage: lastFailure.errorMessage } : null,
  });
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await loadContext(projectId, segmentId);
  if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  if (!context.version?.resultAssetId) return errorResponse(409, "SEGMENT_VERSION_REQUIRED", "请先生成片段视频，再执行连续性质检");
  const structural = structuralReview(context);
  const previous = parseObject(context.version.qualityJson);
  const vision = await getVisionConnection(user.id);
  if (!vision) {
    const quality = { ...previous, structural, semantic: { status: "vision_required" }, overall: { status: "needs_visual_review", score: structural.score }, checkedAt: new Date().toISOString() };
    await getDb().update(segmentVersions).set({ qualityJson: JSON.stringify(quality), status: structural.passed ? "review_required" : "review_failed" }).where(eq(segmentVersions.id, context.version.id));
    return json({ quality, visionConfigured: false, message: "结构检查已完成；还需保存并真实测试支持图片输入的视觉质检模型" });
  }
  const videoAsset = context.assets.find((asset) => asset.id === context.version?.resultAssetId);
  if (!videoAsset) return errorResponse(409, "SEGMENT_VIDEO_ASSET_MISSING", "当前片段视频文件不存在");
  await recoverInterruptedMediaJobs({ ownerId: user.id, projectId, entityType: "segment_version", entityId: context.version.id, operation: qualityOperation });
  const active = (await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment_version"),
    eq(mediaJobs.entityId, context.version.id),
    eq(mediaJobs.operation, qualityOperation),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).limit(1))[0] ?? null;
  if (active) return json({ quality: parseObject(context.version.qualityJson), visionConfigured: true, job: { id: active.id, status: active.status, progress: active.progress }, message: "已恢复当前版本的视觉质检任务" }, { status: 202 });

  const jobId = crypto.randomUUID();
  const startedAt = new Date();
  const checkingQuality = { ...previous, structural, semantic: { status: "running" }, overall: { status: "reviewing", score: structural.score }, checkedAt: startedAt.toISOString() };
  await getDb().insert(mediaJobs).values({
    id: jobId,
    ownerId: user.id,
    projectId,
    entityType: "segment_version",
    entityId: context.version.id,
    operation: qualityOperation,
    status: "running",
    progress: 5,
    payloadJson: JSON.stringify({ segmentId, versionId: context.version.id, versionNumber: context.version.versionNumber, resultAssetId: context.version.resultAssetId }),
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  await getDb().update(segmentVersions).set({ qualityJson: JSON.stringify(checkingQuality), status: "reviewing" }).where(eq(segmentVersions.id, context.version.id));
  waitUntil((async () => {
    try {
    await getDb().update(mediaJobs).set({ progress: 15, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
    const contactSheet = await sampleVideoContactSheet({ video: videoAsset, durationMs: context.segment.durationMs, count: 6 });
    await getDb().update(mediaJobs).set({ progress: 55, updatedAt: new Date() }).where(eq(mediaJobs.id, jobId));
    const assetsById = new Map(context.assets.map((asset) => [asset.id, asset]));
    const semantic = await reviewSegmentContinuity(vision, {
      contactSheetDataUrl: dataUrl(contactSheet.bytes, contactSheet.contentType),
      projectStyle: project.stylePreset,
      segmentTitle: context.segment.title,
      segmentSynopsis: context.segment.synopsis,
      shots: context.shots.map((shot, index) => {
        const refs = referencesForShot(context.references, shot.id);
        return {
          number: index + 1,
          durationSeconds: shot.durationMs / 1_000,
          prompt: shot.prompt,
          characters: refs.filter((reference) => reference.referenceRole === "character").flatMap((reference) => reference.assetId ? [assetsById.get(reference.assetId)?.name ?? "已绑定角色"] : []),
          scene: refs.find((reference) => reference.referenceRole === "scene" && reference.assetId)?.assetId ? assetsById.get(refs.find((reference) => reference.referenceRole === "scene" && reference.assetId)!.assetId!)?.name ?? "已绑定场景" : null,
          dialogue: context.lines.filter((line) => line.shotId === shot.id).map((line) => line.text),
        };
      }),
    });
    const passed = structural.passed && semantic.passed;
    const quality = { ...previous, structural, semantic: { status: "completed", ...semantic, sampledFrames: contactSheet.frameCount }, overall: { status: passed ? "passed" : "failed", score: Math.round((structural.score + semantic.score) / 2) }, checkedAt: new Date().toISOString() };
    await getDb().update(segmentVersions).set({ qualityJson: JSON.stringify(quality), status: passed ? "approved" : "review_failed" }).where(eq(segmentVersions.id, context.version.id));
    const finishedAt = new Date();
    await getDb().update(mediaJobs).set({ status: "succeeded", progress: 100, resultJson: JSON.stringify({ quality, passed, versionId: context.version.id }), finishedAt, updatedAt: finishedAt }).where(eq(mediaJobs.id, jobId));
    } catch (error) {
    const reason = error instanceof Error ? error.message : "SEGMENT_QUALITY_REVIEW_FAILED";
    const quality = { ...previous, structural, semantic: { status: "failed", reason }, overall: { status: "review_error", score: structural.score }, checkedAt: new Date().toISOString() };
    await getDb().update(segmentVersions).set({ qualityJson: JSON.stringify(quality), status: "review_error" }).where(eq(segmentVersions.id, context.version.id));
    const failedAt = new Date();
    await getDb().update(mediaJobs).set({ status: "failed", errorCode: reason.split(":")[0], errorMessage: reason, resultJson: JSON.stringify({ quality, versionId: context.version.id }), finishedAt: failedAt, updatedAt: failedAt }).where(eq(mediaJobs.id, jobId));
    }
  })());
  return json({ quality: checkingQuality, visionConfigured: true, job: { id: jobId, status: "running", progress: 5 }, message: "视觉质检已进入后台，可安全离开页面" }, { status: 202 });
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId, segmentId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const context = await loadContext(projectId, segmentId);
  if (!context) return errorResponse(404, "SEGMENT_NOT_FOUND", "片段不存在或无权访问");
  if (!context.version?.resultAssetId) return errorResponse(409, "SEGMENT_VERSION_REQUIRED", "请先生成片段视频，再进行审片确认");
  const body = await readJson<ReviewBody>(request);
  if (!body?.decision || !["approved", "rejected"].includes(body.decision)) return errorResponse(400, "REVIEW_DECISION_INVALID", "请选择确认可用或标记需重做");

  const active = (await getDb().select().from(mediaJobs).where(and(
    eq(mediaJobs.ownerId, user.id),
    eq(mediaJobs.projectId, projectId),
    eq(mediaJobs.entityType, "segment_version"),
    eq(mediaJobs.entityId, context.version.id),
    eq(mediaJobs.operation, qualityOperation),
    inArray(mediaJobs.status, ["queued", "running"]),
  )).limit(1))[0] ?? null;
  if (active) return errorResponse(409, "SEGMENT_REVIEW_RUNNING", "AI 连续性质检仍在执行，请等待完成后再确认当前版本");

  const structural = structuralReview(context);
  if (body.decision === "approved" && !structural.passed) {
    return errorResponse(409, "SEGMENT_STRUCTURAL_REVIEW_FAILED", "当前版本存在媒体文件或必需资产错误，修复后才能确认可用", { quality: { structural } });
  }
  const previous = parseObject(context.version.qualityJson);
  const reviewedAt = new Date();
  const review = {
    decision: body.decision,
    mode: "creator",
    reviewedAt: reviewedAt.toISOString(),
    reviewedByUserId: user.id,
    note: body.note?.trim().slice(0, 500) || null,
  };
  const previousOverall = previous.overall && typeof previous.overall === "object" && !Array.isArray(previous.overall)
    ? previous.overall as { score?: unknown }
    : null;
  const quality = {
    ...previous,
    structural,
    review,
    overall: {
      status: body.decision === "approved" ? "manually_approved" : "rejected",
      score: typeof previousOverall?.score === "number" ? previousOverall.score : structural.score,
    },
    checkedAt: reviewedAt.toISOString(),
  };
  await getDb().update(segmentVersions).set({
    qualityJson: JSON.stringify(quality),
    status: body.decision === "approved" ? "approved" : "review_failed",
  }).where(eq(segmentVersions.id, context.version.id));
  return json({
    quality,
    visionConfigured: Boolean(await getVisionConnection(user.id)),
    message: body.decision === "approved" ? "当前片段版本已由创作者确认，可进入整集合成" : "当前片段版本已标记为需重做",
  });
}
