import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { assets, canvasEdges, canvasNodes, characterFormReferences, characterForms, characters, episodes, projects, segments, shotAssetReferences, shots, storyBibles, storyScenes } from "../../../../../../db/schema";
import { errorResponse, json } from "../../../../../lib/server/http";
import { getOwnedProject } from "../../../../../lib/server/project-access";
import { getRequestUser } from "../../../../../lib/server/request-user";

type RouteContext = { params: Promise<{ projectId: string }> };
type MaterializedRef = { refType: string; refId: string; assetId?: string; characterId?: string; characterFormId?: string };

function canvasMetadata(value: string, description: string) {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return JSON.stringify({ ...metadata, description, source: metadata.source ?? "canvas" });
}

function nodeContent(node: typeof canvasNodes.$inferSelect) {
  try {
    const parsed = JSON.parse(node.contentJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nodeDescription(node: typeof canvasNodes.$inferSelect) {
  const value = nodeContent(node).meta;
  return typeof value === "string" ? value.trim() : "";
}

function canvasShotDrafts(title: string, prompt: string) {
  const normalized = prompt.trim() || title;
  const parts = normalized
    .split(/\n\s*(?=(?:分镜|镜头)\s*\d+\s*[：:])/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts.length ? parts : [normalized]).slice(0, 12).map((part, index) => {
    const heading = part.match(/^(?:分镜|镜头)\s*\d+\s*[：:]\s*([^\n]{1,40})/i)?.[1]?.trim();
    const seconds = Number(part.match(/(?:时长\s*[：:]?\s*)?(\d+(?:\.\d+)?)\s*秒/)?.[1] ?? 5);
    return {
      title: heading || (parts.length > 1 ? `${title} · 分镜 ${index + 1}` : title),
      prompt: part,
      durationMs: Math.min(15_000, Math.max(1_000, Math.round(seconds * 1_000))),
    };
  });
}

function isUnproducedCanvasShot(shot: typeof shots.$inferSelect) {
  if (shot.status !== "draft" || shot.firstFrameAssetId || shot.videoAssetId) return false;
  try {
    return (JSON.parse(shot.generationPlanJson) as { source?: unknown }).source === "canvas";
  } catch {
    return false;
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { projectId } = await routeContext.params;
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return errorResponse(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问");
  const db = getDb();
  const [nodes, edges, projectAssets, projectCharacters, projectScenes, projectEpisodes, storyBible] = await Promise.all([
    db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
    db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
    db.select().from(characters).where(eq(characters.projectId, projectId)),
    db.select().from(storyScenes).where(eq(storyScenes.projectId, projectId)),
    db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(episodes.episodeNumber),
    db.select({ sourceRevision: storyBibles.sourceRevision }).from(storyBibles).where(eq(storyBibles.projectId, projectId)).limit(1),
  ]);
  if (!nodes.length) return errorResponse(409, "CANVAS_EMPTY", "画布还没有可整理的内容");
  const creativeNodes = nodes.filter((node) => node.refType !== "project_stage");
  if (!creativeNodes.length) return errorResponse(409, "CANVAS_NO_CREATIVE_CONTENT", "请先在画布中添加故事、角色、场景、素材或片段，再整理为短剧项目");
  const now = new Date();
  const currentSourceRevision = storyBible[0]?.sourceRevision ?? 1;
  const refs = new Map<string, MaterializedRef>();
  const existingAsset = (type: string, name: string) => projectAssets.find((asset) => asset.assetType === type && asset.name === name);
  const incomingSources = (nodeId: string) => edges.filter((edge) => edge.toNodeId === nodeId).map((edge) => edge.fromNodeId);
  const incomingAncestors = (nodeId: string) => {
    const found = new Set<string>();
    const visit = (target: string) => incomingSources(target).forEach((sourceId) => {
      if (found.has(sourceId)) return;
      found.add(sourceId);
      visit(sourceId);
    });
    visit(nodeId);
    return [...found];
  };
  const linkedVisualReference = (nodeId: string) => incomingSources(nodeId)
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node) => node?.nodeType === "media" && node.refType === "asset" && node.refId)
    .map((node) => projectAssets.find((asset) => asset.id === node!.refId))
    .find((asset) => asset && (asset.storageKey || asset.thumbnailUrl)) ?? null;
  const adoptVisualReference = async (target: typeof assets.$inferSelect, source: typeof assets.$inferSelect | null, description: string) => {
    if (!source || source.id === target.id) return;
    const sourceMetadata = (() => {
      try { return JSON.parse(source.metadataJson || "{}") as Record<string, unknown>; } catch { return {}; }
    })();
    const patch = {
      status: source.status === "ready" && Boolean(source.storageKey || source.thumbnailUrl) ? "ready" : target.status,
      storageKey: source.storageKey,
      thumbnailUrl: source.thumbnailUrl,
      metadataJson: JSON.stringify({ ...sourceMetadata, description, source: "canvas_reference", sourceAssetId: source.id }),
      updatedAt: now,
    };
    await db.update(assets).set(patch).where(eq(assets.id, target.id));
    Object.assign(target, patch);
  };
  const ensurePrimaryCharacterReference = async (characterFormId: string, assetId: string) => {
    const existing = (await db.select().from(characterFormReferences).where(eq(characterFormReferences.characterFormId, characterFormId)).orderBy(characterFormReferences.referenceOrder).limit(1))[0];
    if (existing) {
      await db.update(characterFormReferences).set({ assetId, referenceType: "primary", referenceOrder: 0, isPrimary: true, updatedAt: now }).where(eq(characterFormReferences.id, existing.id));
      return;
    }
    await db.insert(characterFormReferences).values({ id: crypto.randomUUID(), characterFormId, assetId, referenceType: "primary", referenceOrder: 0, isPrimary: true, createdAt: now, updatedAt: now });
  };

  for (const node of creativeNodes) {
    const content = nodeContent(node);
    const meta = typeof content.meta === "string" ? content.meta : "";
    if (node.refType && node.refId) {
      if (node.refType === "character") {
        const character = projectCharacters.find((item) => item.id === node.refId);
        const form = character ? (await db.select().from(characterForms).where(eq(characterForms.characterId, character.id)).limit(1))[0] : null;
        if (character) {
          await db.update(characters).set({ canonicalName: node.title, profileJson: canvasMetadata(character.profileJson, meta), updatedAt: now }).where(eq(characters.id, character.id));
          if (character.assetId) {
            const asset = projectAssets.find((item) => item.id === character.assetId);
            if (asset) await db.update(assets).set({ name: node.title, metadataJson: canvasMetadata(asset.metadataJson, meta), updatedAt: now }).where(eq(assets.id, asset.id));
          }
          if (form && meta) await db.update(characterForms).set({ description: meta, updatedAt: now }).where(eq(characterForms.id, form.id));
          if (form && (form.assetId || character.assetId)) await ensurePrimaryCharacterReference(form.id, form.assetId || character.assetId!);
        }
        refs.set(node.id, { refType: node.refType, refId: node.refId, characterId: node.refId, characterFormId: form?.id, assetId: form?.assetId || character?.assetId || undefined });
      } else if (node.refType === "story_scene") {
        const scene = projectScenes.find((item) => item.id === node.refId);
        if (scene) {
          await db.update(storyScenes).set({ name: node.title, visualContinuityJson: canvasMetadata(scene.visualContinuityJson, meta), updatedAt: now }).where(eq(storyScenes.id, scene.id));
          if (scene.assetId) {
            const asset = projectAssets.find((item) => item.id === scene.assetId);
            if (asset) await db.update(assets).set({ name: node.title, metadataJson: canvasMetadata(asset.metadataJson, meta), updatedAt: now }).where(eq(assets.id, asset.id));
          }
        }
        refs.set(node.id, { refType: node.refType, refId: node.refId, assetId: scene?.assetId || undefined });
      } else {
        if (node.refType === "asset") {
          const asset = projectAssets.find((item) => item.id === node.refId);
          if (asset) await db.update(assets).set({ name: node.title, metadataJson: canvasMetadata(asset.metadataJson, meta), updatedAt: now }).where(eq(assets.id, asset.id));
        }
        refs.set(node.id, { refType: node.refType, refId: node.refId, assetId: node.refType === "asset" ? node.refId : undefined });
      }
      continue;
    }
    if (node.nodeType === "role") {
      let character = projectCharacters.find((item) => item.canonicalName === node.title) ?? null;
      let asset = character?.assetId ? projectAssets.find((item) => item.id === character!.assetId) ?? null : existingAsset("character", node.title) ?? null;
      if (!asset) {
        asset = { id: crypto.randomUUID(), projectId, episodeId: null, assetType: "character", sourceRevision: null, name: node.title, status: "draft", storageKey: null, thumbnailUrl: null, metadataJson: JSON.stringify({ description: meta, source: "canvas" }), createdAt: now, updatedAt: now };
        await db.insert(assets).values(asset);
        projectAssets.push(asset);
      }
      await adoptVisualReference(asset, linkedVisualReference(node.id), meta);
      if (!character) {
        character = { id: crypto.randomUUID(), projectId, assetId: asset.id, canonicalName: node.title, profileJson: JSON.stringify({ description: meta, source: "canvas" }), voiceAssetId: null, voiceDescription: null, voiceLocked: false, createdAt: now, updatedAt: now };
        await db.insert(characters).values(character);
        projectCharacters.push(character);
      }
      let form = (await db.select().from(characterForms).where(eq(characterForms.characterId, character.id)).limit(1))[0] ?? null;
      if (!form) {
        form = { id: crypto.randomUUID(), characterId: character.id, name: "基础形象", description: meta, assetId: asset.id, episodeScopeJson: "[]", inheritVoice: true, createdAt: now, updatedAt: now };
        await db.insert(characterForms).values(form);
      }
      await ensurePrimaryCharacterReference(form.id, asset.id);
      refs.set(node.id, { refType: "character", refId: character.id, characterId: character.id, characterFormId: form.id, assetId: asset.id });
    } else if (node.nodeType === "scene") {
      let asset = existingAsset("scene", node.title) ?? null;
      if (!asset) {
        asset = { id: crypto.randomUUID(), projectId, episodeId: null, assetType: "scene", sourceRevision: null, name: node.title, status: "draft", storageKey: null, thumbnailUrl: null, metadataJson: JSON.stringify({ description: meta, source: "canvas" }), createdAt: now, updatedAt: now };
        await db.insert(assets).values(asset);
        projectAssets.push(asset);
      }
      await adoptVisualReference(asset, linkedVisualReference(node.id), meta);
      let scene = projectScenes.find((item) => item.name === node.title) ?? null;
      if (!scene) {
        scene = { id: crypto.randomUUID(), projectId, assetId: asset.id, name: node.title, episodeScopeJson: "[]", timeOfDay: null, interiorExterior: null, visualContinuityJson: JSON.stringify({ description: meta, source: "canvas" }), audioPresetId: null, status: "draft", createdAt: now, updatedAt: now };
        await db.insert(storyScenes).values(scene);
        projectScenes.push(scene);
      }
      refs.set(node.id, { refType: "story_scene", refId: scene.id, assetId: asset.id });
    } else if (["prop", "media"].includes(node.nodeType)) {
      const type = node.nodeType === "prop" ? "prop" : "material";
      let asset = existingAsset(type, node.title) ?? null;
      if (!asset) {
        asset = { id: crypto.randomUUID(), projectId, episodeId: null, assetType: type, sourceRevision: null, name: node.title, status: "draft", storageKey: null, thumbnailUrl: null, metadataJson: JSON.stringify({ description: meta, source: "canvas" }), createdAt: now, updatedAt: now };
        await db.insert(assets).values(asset);
        projectAssets.push(asset);
      }
      if (node.nodeType === "prop") await adoptVisualReference(asset, linkedVisualReference(node.id), meta);
      refs.set(node.id, { refType: "asset", refId: asset.id, assetId: asset.id });
    }
  }

  let episode = projectEpisodes[0] ?? null;
  const ideaText = creativeNodes.filter((node) => node.nodeType === "idea").map((node) => {
    try { return String((JSON.parse(node.contentJson) as { meta?: string }).meta || node.title); } catch { return node.title; }
  }).filter(Boolean).join("\n\n");
  if (!episode && (ideaText || creativeNodes.some((node) => node.nodeType === "shot"))) {
    episode = { id: crypto.randomUUID(), projectId, episodeNumber: 1, title: "第 1 集", summary: ideaText.slice(0, 2_000) || null, scriptText: ideaText || null, status: "draft", videoAssetId: null, subtitleAssetId: null, currentVersionNumber: 0, createdAt: now, updatedAt: now };
    await db.insert(episodes).values(episode);
  }

  const existingSegments = episode ? await db.select().from(segments).where(and(eq(segments.episodeId, episode.id), eq(segments.sourceRevision, currentSourceRevision))).orderBy(segments.sequence) : [];
  const existingShots = episode ? await db.select().from(shots).where(and(eq(shots.episodeId, episode.id), eq(shots.sourceRevision, currentSourceRevision))).orderBy(shots.sequence) : [];
  let nextSegmentSequence = Math.max(0, ...existingSegments.map((item) => item.sequence)) + 1;
  let nextShotSequence = Math.max(0, ...existingShots.map((item) => item.sequence)) + 1;
  for (const node of creativeNodes.filter((item) => item.nodeType === "shot")) {
    if (!episode) continue;
    let segment = node.refType === "segment" && node.refId ? existingSegments.find((item) => item.id === node.refId) ?? null : null;
    const content = nodeContent(node);
    const prompt = typeof content.meta === "string" && content.meta.trim() ? content.meta.trim() : node.title;
    const storyContext = incomingAncestors(node.id)
      .map((id) => nodes.find((item) => item.id === id))
      .filter((item): item is typeof canvasNodes.$inferSelect => item?.nodeType === "idea")
      .map((item) => nodeDescription(item) || item.title)
      .filter(Boolean)
      .join("\n");
    const productionPrompt = storyContext && !prompt.includes(storyContext)
      ? `故事上下文：\n${storyContext}\n\n片段导演要求：\n${prompt}`
      : prompt;
    const drafts = canvasShotDrafts(node.title, prompt).map((draft) => ({
      ...draft,
      prompt: storyContext && !draft.prompt.includes(storyContext)
        ? `故事上下文：\n${storyContext}\n\n本分镜导演要求：\n${draft.prompt}`
        : draft.prompt,
    }));
    const sceneRef = incomingSources(node.id).map((id) => refs.get(id)).find((ref) => ref?.refType === "story_scene");
    const linkedRefs = incomingSources(node.id).map((id) => refs.get(id)).filter((ref): ref is MaterializedRef => Boolean(ref?.assetId));
    const wasExisting = Boolean(segment);
    if (!segment) {
      segment = { id: crypto.randomUUID(), episodeId: episode.id, storySceneId: sceneRef?.refId ?? null, sequence: nextSegmentSequence++, sourceRevision: currentSourceRevision, title: node.title, synopsis: productionPrompt, directorPrompt: null, referenceMode: "automatic", durationMs: drafts.reduce((sum, draft) => sum + draft.durationMs, 0), status: "draft", videoAssetId: null, audioAssetId: null, currentVersionNumber: 0, createdAt: now, updatedAt: now };
      await db.insert(segments).values(segment);
      existingSegments.push(segment);
    } else {
      await db.update(segments).set({ title: node.title, synopsis: productionPrompt, ...(sceneRef ? { storySceneId: sceneRef.refId } : {}), updatedAt: now }).where(eq(segments.id, segment.id));
    }

    let segmentShots = existingShots.filter((item) => item.segmentId === segment!.id);
    const canReplaceDrafts = wasExisting && segment.currentVersionNumber === 0 && !segment.videoAssetId && segmentShots.length > 0 && segmentShots.every(isUnproducedCanvasShot);
    if (!segmentShots.length) {
      for (const draft of drafts) {
        const shot = { id: crypto.randomUUID(), episodeId: episode.id, segmentId: segment.id, sequence: nextShotSequence++, sourceRevision: currentSourceRevision, title: draft.title, prompt: draft.prompt, durationMs: draft.durationMs, shotType: "visual", cameraJson: "{}", soundPlanJson: "{}", generationPlanJson: JSON.stringify({ source: "canvas", intent: { hasDialogue: false } }), status: "draft", firstFrameAssetId: null, videoAssetId: null, environmentPresetId: null, createdAt: now, updatedAt: now };
        await db.insert(shots).values(shot);
        existingShots.push(shot);
      }
      segmentShots = existingShots.filter((item) => item.segmentId === segment!.id);
    } else if (canReplaceDrafts && segmentShots.length === drafts.length) {
      for (const [index, shot] of segmentShots.entries()) {
        const draft = drafts[index];
        await db.update(shots).set({ title: draft.title, prompt: draft.prompt, durationMs: draft.durationMs, updatedAt: now }).where(eq(shots.id, shot.id));
      }
      await db.update(segments).set({ durationMs: drafts.reduce((sum, draft) => sum + draft.durationMs, 0), updatedAt: now }).where(eq(segments.id, segment.id));
    }

    if (!wasExisting || canReplaceDrafts) {
      for (const shot of segmentShots) {
        await db.delete(shotAssetReferences).where(eq(shotAssetReferences.shotId, shot.id));
        for (const [index, ref] of linkedRefs.entries()) {
          await db.insert(shotAssetReferences).values({ id: crypto.randomUUID(), shotId: shot.id, assetId: ref.assetId ?? null, characterId: ref.characterId ?? null, characterFormId: ref.characterFormId ?? null, referenceRole: ref.characterId ? "character" : ref.refType === "story_scene" ? "scene" : "prop", referenceOrder: index, required: true, createdAt: now, updatedAt: now });
        }
      }
    }
    refs.set(node.id, { refType: "segment", refId: segment.id });
  }

  for (const node of creativeNodes.filter((item) => item.nodeType === "video")) {
    const sourceShotId = incomingAncestors(node.id).find((id) => refs.get(id)?.refType === "segment");
    const source = sourceShotId ? refs.get(sourceShotId) : null;
    if (source) refs.set(node.id, { refType: "segment_video", refId: source.refId });
  }
  for (const [nodeId, ref] of refs) await db.update(canvasNodes).set({ refType: ref.refType, refId: ref.refId, updatedAt: now }).where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.projectId, projectId)));
  await db.update(projects).set({ status: episode && existingShots.length ? "storyboarding" : "assets", updatedAt: now }).where(eq(projects.id, projectId));
  const unreadyAssets = projectAssets.filter((asset) => ["character", "scene", "prop", "material"].includes(asset.assetType) && (!asset.storageKey || asset.status !== "ready"));
  return json({
    materialized: true,
    episodeId: episode?.id ?? null,
    assetCount: projectAssets.length,
    shotCount: existingShots.length,
    unreadyAssetCount: unreadyAssets.length,
    target: unreadyAssets.length ? "assets" : existingShots.length ? "videos" : "assets",
    refs: Object.fromEntries(refs),
  });
}
