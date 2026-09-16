import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ships the approved Xiaofeixiang creation flow", async () => {
  const [page, studio, canvas, assets, characterDetail, layout, packageJson] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/canvas/CanvasWorkspace.tsx"),
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/features/assets/CharacterDetailModal.tsx"),
    read("../app/layout.tsx"),
    read("../package.json"),
  ]);
  assert.match(page, /StudioApp/);
  assert.match(studio, /SettingsProvider/);
  assert.doesNotMatch(studio, /WorkflowCenter/);
  assert.match(studio, /FreeCanvasPage/);
  assert.match(canvas, /function CanvasWorkspace/);
  assert.match(canvas, /from "@xyflow\/react"/);
  assert.match(canvas, /<ReactFlow/);
  assert.doesNotMatch(canvas, /FlowCanvasLines/);
  assert.match(canvas, /已自动保存/);
  assert.match(assets, /CharacterDetailModal/);
  assert.match(characterDetail, /固定音色/);
  assert.match(characterDetail, /character-form-switcher/);
  assert.match(layout, /小飞象/);
  assert.match(packageJson, /xiaofeixiang-studio/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});

test("keeps the frontend entrypoint thin and features modular", async () => {
  const [page, plan] = await Promise.all([
    read("../app/page.tsx"),
    read("../docs/development-plan.md"),
  ]);
  assert.ok(page.split("\n").length < 20);
  assert.match(plan, /apps\/web/);
  assert.match(plan, /PostgreSQL/);
  assert.match(plan, /Redis、BullMQ/);
  assert.match(plan, /当前本地 D1\/R2 仅用于产品链路开发/);
});

test("defines durable product data and ComfyUI job boundaries", async () => {
  const [schema, migration, jobsRoute, requirements] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0000_gifted_vanisher.sql"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/lib/workflow-capabilities.ts"),
  ]);
  for (const table of ["users", "serviceConnections", "projects", "episodes", "assets", "characters", "shots", "canvasNodes", "canvasEdges", "workflowBindings", "generationJobs", "workflowTestRuns"]) {
    assert.match(schema, new RegExp(`export const ${table}`));
  }
  assert.match(migration, /CREATE TABLE `generation_jobs`/);
  assert.match(jobsRoute, /WORKFLOW_NOT_VERIFIED/);
  assert.match(jobsRoute, /queueWorkflow/);
  assert.match(requirements, /native_audio_video/);
  assert.match(requirements, /ambient_audio/);
});

test("canvas API persists nodes and edges for an owned project", async () => {
  const [route, materializeRoute, uploadRoute, projectRoute, canvas] = await Promise.all([
    read("../app/api/projects/[projectId]/canvas/route.ts"),
    read("../app/api/projects/[projectId]/canvas/materialize/route.ts"),
    read("../app/api/projects/[projectId]/assets/upload/route.ts"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/features/canvas/CanvasWorkspace.tsx"),
  ]);
  assert.match(route, /getOwnedProject/);
  assert.match(route, /DELETE FROM canvas_edges/);
  assert.match(route, /INSERT INTO canvas_nodes/);
  assert.match(route, /INSERT INTO canvas_edges/);
  assert.match(route, /CANVAS_TOO_LARGE/);
  assert.match(route, /DUPLICATE_CANVAS_ID/);
  assert.match(route, /CANVAS_ID_CONFLICT/);
  assert.match(materializeRoute, /insert\(characters\)/);
  assert.match(materializeRoute, /insert\(storyScenes\)/);
  assert.match(materializeRoute, /insert\(segments\)/);
  assert.match(materializeRoute, /insert\(shots\)/);
  assert.match(materializeRoute, /shotAssetReferences/);
  assert.match(materializeRoute, /db\.update\(characters\)/);
  assert.match(materializeRoute, /db\.update\(storyScenes\)/);
  assert.match(materializeRoute, /canvasMetadata/);
  assert.match(materializeRoute, /linkedVisualReference/);
  assert.match(materializeRoute, /source: "canvas_reference"/);
  assert.match(materializeRoute, /故事上下文/);
  assert.match(materializeRoute, /incomingSources/);
  assert.match(materializeRoute, /refType: "segment_video"/);
  assert.match(materializeRoute, /node\.refType !== "project_stage"/);
  assert.match(materializeRoute, /CANVAS_NO_CREATIVE_CONTENT/);
  assert.match(uploadRoute, /getMediaBucket\(\)\.put/);
  assert.match(uploadRoute, /MEDIA_TYPE_UNSUPPORTED/);
  assert.match(projectRoute, /getMediaBucket/);
  assert.match(projectRoute, /bucket\.delete/);
  assert.match(canvas, /projectFlow/);
  assert.match(canvas, /materializeCanvas/);
  assert.match(canvas, /uploadMaterial/);
  assert.match(canvas, /allowedConnectionTargets/);
  assert.match(canvas, /isValidConnection/);
  assert.match(canvas, /productionLayout/);
  assert.match(canvas, /node-production-state/);
  assert.match(canvas, /uniqueNodeByReference/);
  assert.match(canvas, /segment_video/);
  assert.doesNotMatch(canvas, /林微|陈屹|校园悬疑灵感/);
  assert.doesNotMatch(canvas, /生成新版本/);
});

test("connects account-owned projects to the visible creation flow", async () => {
  const [login, studio, home, drama, projectRoute, episodeRoute, episodeCollectionRoute, regenerateRoute, script] = await Promise.all([
    read("../app/features/auth/Login.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/home/Home.tsx"),
    read("../app/features/drama/DramaHub.tsx"),
    read("../app/api/projects/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/route.ts"),
    read("../app/api/projects/[projectId]/episodes/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/regenerate/route.ts"),
    read("../app/features/script/ScriptPage.tsx"),
  ]);
  assert.match(login, /fetch\("\/api\/me"/);
  assert.match(studio, /activeProject/);
  assert.match(studio, /startCreation/);
  assert.match(home, /onStartCreation\("自由画布"\)/);
  assert.match(drama, /initialMode/);
  assert.match(drama, /projectResumeTarget/);
  assert.match(drama, /"storyboarding", "production", "rendering", "rendered", "delivered"/);
  assert.match(drama, /project-card-delete/);
  assert.match(drama, /method: "DELETE"/);
  assert.match(drama, /initialScript/);
  assert.match(drama, /episodeCount/);
  assert.match(drama, /readScriptFile/);
  assert.doesNotMatch(drama, /支持 TXT、DOCX、PDF/);
  assert.match(projectRoute, /getD1\(\)\.batch/);
  assert.match(projectRoute, /sourceText: sourceType === "upload" \? initialScript : null/);
  assert.match(episodeRoute, /getOwnedProject/);
  assert.match(episodeCollectionRoute, /insert\(episodes\)/);
  assert.match(regenerateRoute, /OUTLINE_REQUIRED/);
  assert.match(regenerateRoute, /storyOutline/);
  assert.match(regenerateRoute, /LLM_REQUIRED/);
  assert.match(script, /800/);
  assert.match(script, /新增一集/);
  assert.match(script, /regenerateEpisode/);
  assert.doesNotMatch(script, /新增一集（即将开放）/);
  assert.match(script, /确认全剧剧本，进入资产库/);
  assert.match(script, /project\.sourceText/);
  assert.match(script, /原始剧本/);
});

test("preserves an uploaded source script while deriving editable episodes", async () => {
  const [schema, platformSchema, migration, projectRoute, llm, structuringRunner, structureRetryRoute, extractionRoute, scriptPage] = await Promise.all([
    read("../db/schema.ts"),
    read("../packages/database/src/schema.ts"),
    read("../drizzle/0013_spotty_proudstar.sql"),
    read("../app/api/projects/route.ts"),
    read("../app/lib/server/llm.ts"),
    read("../app/lib/server/uploaded-script-structuring.ts"),
    read("../app/api/projects/[projectId]/structure-script/route.ts"),
    read("../app/api/projects/[projectId]/extract-assets/route.ts"),
    read("../app/features/script/ScriptPage.tsx"),
  ]);
  assert.match(schema, /sourceText: text\("source_text"\)/);
  assert.match(platformSchema, /sourceText: text\("source_text"\)/);
  assert.match(migration, /ALTER TABLE `projects` ADD `source_text` text/);
  assert.match(projectRoute, /source_text/);
  assert.match(projectRoute, /executeUploadedScriptStructuring/);
  assert.match(projectRoute, /"llm_structure"/);
  assert.match(llm, /structureUploadedDrama/);
  assert.match(llm, /LLM_STRUCTURE_INCOMPLETE/);
  assert.match(structuringRunner, /ON CONFLICT\(project_id, episode_number\) DO UPDATE/);
  assert.match(structuringRunner, /script_structure_failed/);
  assert.match(structureRetryRoute, /retryOf: failedJob\.id/);
  assert.match(extractionRoute, /EPISODE_SCRIPT_INCOMPLETE/);
  assert.doesNotMatch(extractionRoute, /splitUploadedDrama/);
  assert.match(scriptPage, /script-outline-section/);
  assert.match(scriptPage, /人物小传/);
  assert.match(scriptPage, /剧本摘要/);
  assert.match(scriptPage, /parseStoryOutline/);
  assert.doesNotMatch(scriptPage, /原始内容保存在分集剧本中/);
});

test("persists and resumes every long-running text intelligence task", async () => {
  const [projectRoute, dramaRunner, dramaRetryRoute, structuringRunner, structureRetryRoute, analysisRoute, episodeRoute, jobRoute, recovery, projectDetailRoute, scriptPage, assetsPage] = await Promise.all([
    read("../app/api/projects/route.ts"),
    read("../app/lib/server/drama-script-generation.ts"),
    read("../app/api/projects/[projectId]/generate-script/route.ts"),
    read("../app/lib/server/uploaded-script-structuring.ts"),
    read("../app/api/projects/[projectId]/structure-script/route.ts"),
    read("../app/api/projects/[projectId]/extract-assets/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/regenerate/route.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/lib/server/text-job-recovery.ts"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/features/script/ScriptPage.tsx"),
    read("../app/features/assets/AssetsPage.tsx"),
  ]);
  assert.match(projectRoute, /waitUntil/);
  assert.match(projectRoute, /"llm_script"/);
  assert.match(projectRoute, /"llm_structure"/);
  assert.match(dramaRunner, /script_generation_failed/);
  assert.match(projectRoute, /status: 202/);
  assert.match(projectRoute, /executeDramaScriptGeneration/);
  assert.match(dramaRunner, /ON CONFLICT\(project_id, episode_number\) DO UPDATE/);
  assert.match(dramaRunner, /script_generation_failed/);
  assert.match(dramaRetryRoute, /retryOf: latestScriptJob\?\.status === "failed" \? latestScriptJob\.id : null/);
  assert.match(dramaRetryRoute, /requestedEpisodeCount\(failedJob\.payloadJson, episodeCount\)/);
  assert.match(dramaRetryRoute, /episodes_only/);
  assert.match(dramaRetryRoute, /OUTLINE_REQUIRED/);
  assert.match(scriptPage, /重新生成全部分集/);
  assert.match(structuringRunner, /script_structure_failed/);
  assert.match(structureRetryRoute, /STRUCTURE_RETRY_NOT_REQUIRED/);
  assert.match(structureRetryRoute, /executeUploadedScriptStructuring/);
  assert.match(analysisRoute, /waitUntil/);
  assert.match(analysisRoute, /capability: "llm_analysis"/);
  assert.match(analysisRoute, /script_analysis_failed/);
  assert.match(episodeRoute, /waitUntil/);
  assert.match(episodeRoute, /capability: "llm_episode"/);
  assert.match(episodeRoute, /allowedCharacterNames/);
  assert.match(episodeRoute, /episodeOutlinePromptFromStoryBible/);
  assert.match(episodeRoute, /status: 202/);
  assert.match(recovery, /TEXT_JOB_INTERRUPTED/);
  assert.match(recovery, /5 \* 60 \* 1_000/);
  assert.match(jobRoute, /bridgeExecutionFailureMessage/);
  assert.match(jobRoute, /historyExecutionError/);
  assert.match(projectDetailRoute, /generationJobs: projectGenerationJobs/);
  assert.match(scriptPage, /activeTextJob/);
  assert.match(scriptPage, /api\/generation\/jobs/);
  assert.match(scriptPage, /重新生成全剧/);
  assert.match(scriptPage, /projectScriptPhaseComplete/);
  assert.match(scriptPage, /返回资产库/);
  assert.match(scriptPage, /api\/projects\/\$\{projectId\}\/generate-script/);
  assert.match(scriptPage, /api\/projects\/\$\{projectId\}\/structure-script/);
  assert.match(assetsPage, /analysisJobId/);
  assert.match(assetsPage, /资产提取任务状态读取失败/);
});

test("blocks storyboard generation until director analysis and locked visual assets are ready", async () => {
  const { getStoryboardGenerationBlockers, structuredEpisodesFromTimeline } = await import("../app/lib/storyboard-readiness.ts");
  const [videosPage] = await Promise.all([read("../app/features/videos/VideosPage.tsx")]);
  assert.deepEqual(structuredEpisodesFromTimeline(JSON.stringify([{ episodeNumber: 1, segments: [{ shots: [{ title: "开场" }] }] }])), [{ episodeNumber: 1, segments: [{ shots: [{ title: "开场" }] }] }]);
  assert.equal(structuredEpisodesFromTimeline(JSON.stringify([{ episode: 1, title: "第一集" }])).length, 0);
  const blockers = getStoryboardGenerationBlockers({
    episodeCount: 1,
    timelineJson: "[]",
    assets: [{ id: "scene-1", assetType: "scene", name: "拳台", status: "ready", storageKey: "k", metadataJson: "{}" }],
    characterForms: [{ id: "form-1", name: "基础形象", assetId: "char-1" }],
  });
  assert.match(blockers.join(" "), /重新提取资产/);
  assert.match(blockers.join(" "), /尚未生成/);
  assert.doesNotMatch(blockers.join(" "), /确认并锁定/);
  assert.match(videosPage, /storyboard-blocked-banner/);
  assert.match(videosPage, /还不能生成分镜脚本/);
  assert.match(videosPage, /待生成分镜脚本/);
});

test("accepts JSON from reasoning-capable OpenAI-compatible models", async () => {
  const { extractJson } = await import("../app/lib/server/llm-json.ts");
  assert.deepEqual(extractJson('<think>分析 {"draft":true}</think>\n{"title":"最终答案","episodes":[]}'), { title: "最终答案", episodes: [] });
  assert.deepEqual(extractJson('<think>未闭合思考 {"draft":true}\n最终：{"title":"后置答案"}'), { title: "后置答案" });
  assert.deepEqual(extractJson('```json\n{"text":"大括号 { 在字符串里"}\n```'), { text: "大括号 { 在字符串里" });
  assert.throws(() => extractJson("没有结构化结果"), /LLM_JSON_INVALID/);
});

test("stores local D1 timestamps in seconds and repairs legacy millisecond rows", async () => {
  const [projectRoute, extractRoute, storyboardRoute, migration] = await Promise.all([
    read("../app/api/projects/route.ts"),
    read("../app/api/projects/[projectId]/extract-assets/route.ts"),
    read("../app/api/projects/[projectId]/storyboards/route.ts"),
    read("../drizzle/0008_repair_timestamp_seconds.sql"),
  ]);
  assert.match(projectRoute, /const nowSeconds = Math\.floor\(now\.getTime\(\) \/ 1_000\)/);
  assert.doesNotMatch(projectRoute, /now\.getTime\(\),/);
  assert.match(extractRoute, /Math\.floor\(Date\.now\(\) \/ 1_000\)/);
  assert.match(storyboardRoute, /Math\.floor\(Date\.now\(\) \/ 1_000\)/);
  assert.match(migration, /CAST\(`created_at` \/ 1000 AS INTEGER\)/);
  assert.match(migration, /WHERE `updated_at` > 100000000000/);
});

test("configures an encrypted LLM service and generates real episodic scripts", async () => {
  const [schema, migration, credentials, serviceReadiness, llm, dramaRunner, connectionsRoute, testRoute, projectRoute, enginePanel, home] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0005_slimy_tomorrow_man.sql"),
    read("../app/lib/server/credentials.ts"),
    read("../app/lib/service-readiness.ts"),
    read("../app/lib/server/llm.ts"),
    read("../app/lib/server/drama-script-generation.ts"),
    read("../app/api/engine/connections/route.ts"),
    read("../app/api/engine/connections/test/route.ts"),
    read("../app/api/projects/route.ts"),
    read("../app/features/settings/EngineConnectionsPanel.tsx"),
    read("../app/features/home/Home.tsx"),
  ]);
  assert.match(schema, /serviceConnections/);
  assert.match(migration, /CREATE TABLE `service_connections`/);
  assert.match(credentials, /AES-GCM/);
  assert.match(credentials, /CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(llm, /generateDramaScript/);
  assert.match(llm, /generateDramaOutline/);
  assert.match(llm, /generateDramaEpisodes/);
  assert.match(llm, /extractJson/);
  assert.match(llm, /LLM_EPISODE_CHARACTER_ROSTER_MISMATCH/);
  assert.match(dramaRunner, /formatOutlineForEpisodeGeneration/);
  assert.match(dramaRunner, /episodeOutlinePromptFromStoryBible/);
  assert.match(llm, /LLM_OUTLINE_CHARACTERS_MISSING/);
  assert.match(llm, /analyzeDramaScript/);
  assert.match(llm, /dramaAnalysisTimeoutMs/);
  assert.match(llm, /片段-分镜生产草案/);
  assert.match(llm, /chat\/completions/);
  assert.match(connectionsRoute, /encryptCredential/);
  assert.match(connectionsRoute, /lastTestStatus: "invalidated"/);
  assert.match(serviceReadiness, /lastTestedAt/);
  assert.match(testRoute, /testLlmConnection/);
  assert.match(testRoute, /testingSavedConfiguration/);
  assert.match(testRoute, /lastTestStatus: "succeeded"/);
  assert.match(testRoute, /lastTestStatus: "failed"/);
  assert.match(projectRoute, /LLM_REQUIRED/);
  assert.match(projectRoute, /executeDramaScriptGeneration/);
  assert.match(dramaRunner, /generateDramaOutline/);
  assert.match(dramaRunner, /generateDramaEpisodes/);
  assert.match(enginePanel, /从创意生成剧本/);
  assert.match(enginePanel, /已验证/);
  assert.doesNotMatch(home, /演示模式|setToast/);
});

test("allows script structure labels and generic npcs during roster validation", async () => {
  const dramaOutline = await read("../app/lib/drama-outline.ts");
  assert.match(dramaOutline, /isScriptStructureLabel/);
  assert.match(dramaOutline, /\/小贩\//);
  assert.match(dramaOutline, /isScriptStructureLine/);
  assert.match(dramaOutline, /world\.characters/);
});

test("persists selectable visual style and aspect ratio across all creation entrances", async () => {
  const [presets, home, drama, projectRoute] = await Promise.all([
    read("../app/lib/project-presets.ts"),
    read("../app/features/home/Home.tsx"),
    read("../app/features/drama/DramaHub.tsx"),
    read("../app/api/projects/route.ts"),
  ]);
  assert.match(presets, /国风仙侠/);
  assert.match(presets, /二次元动画/);
  assert.match(presets, /"9:16"/);
  assert.match(home, /projectStylePresets\.map/);
  assert.match(home, /stylePreset, aspectRatio/);
  assert.match(drama, /project-creation-settings/);
  assert.match(drama, /成片画幅/);
  assert.match(projectRoute, /projectAspectRatios\.includes/);
  assert.match(projectRoute, /stylePreset,/);
});

test("persists asset extraction, sound continuity, and storyboard editing", async () => {
  const [extractRoute, characterRoute, audioRoute, storyboardRoute, shotRoute, assetsPage, videosPage, editorPage] = await Promise.all([
    read("../app/api/projects/[projectId]/extract-assets/route.ts"),
    read("../app/api/projects/[projectId]/characters/[characterId]/route.ts"),
    read("../app/api/projects/[projectId]/audio-presets/[presetId]/route.ts"),
    read("../app/api/projects/[projectId]/storyboards/route.ts"),
    read("../app/api/projects/[projectId]/shots/[shotId]/route.ts"),
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../app/features/editor/EditorPage.tsx"),
  ]);
  assert.match(extractRoute, /analyzeDramaScript/);
  assert.match(extractRoute, /existingWorld/);
  assert.match(extractRoute, /LLM_REQUIRED/);
  assert.match(extractRoute, /EPISODE_SCRIPT_INCOMPLETE/);
  assert.match(extractRoute, /status: "confirmed"/);
  assert.doesNotMatch(extractRoute, /INSERT INTO episodes/);
  assert.doesNotMatch(extractRoute, /extractScriptAssets/);
  assert.doesNotMatch(extractRoute, /INSERT INTO audio_presets/);
  assert.match(characterRoute, /voiceLocked/);
  assert.match(audioRoute, /locked/);
  assert.match(storyboardRoute, /environmentPresetId/);
  assert.match(storyboardRoute, /structuredEpisodes/);
  assert.match(storyboardRoute, /SCRIPT_ANALYSIS_REQUIRED/);
  assert.match(shotRoute, /SHOT_NOT_FOUND/);
  assert.match(assetsPage, /CharacterDetailModal/);
  assert.match(assetsPage, /保存并锁定声音场/);
  assert.match(videosPage, /继承场景声音场/);
  assert.match(editorPage, /storyboard_frame/);
  assert.match(editorPage, /WORKFLOW_REQUIRED|需要先配置/);
});

test("generates every project-level visual asset with durable form and prop references", async () => {
  const [schema, platformSchema, migration, referenceMigration, generationSubmit, jobRoute, assetApprovalRoute, approveRoute, approvalBatch, assetBatchRoute, assetBatchModel, assetBatchRunner, productionTick, extractRoute, storyboardRoute, productionPlanRoute, segmentGenerateRoute, segmentReferences, projectRoute, assetsPage, characterDetailModal] = await Promise.all([
    read("../db/schema.ts"),
    read("../packages/database/src/schema.ts"),
    read("../drizzle/0006_luxuriant_hedge_knight.sql"),
    read("../drizzle/0012_romantic_leader.sql"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/assets/[assetId]/route.ts"),
    read("../app/api/projects/[projectId]/assets/approve/route.ts"),
    read("../app/lib/server/visual-asset-approval-batch.ts"),
    read("../app/api/projects/[projectId]/assets/produce/route.ts"),
    read("../app/lib/server/visual-asset-batch.ts"),
    read("../app/lib/server/visual-asset-batch-runner.ts"),
    read("../app/api/internal/production/tick/route.ts"),
    read("../app/api/projects/[projectId]/extract-assets/route.ts"),
    read("../app/api/projects/[projectId]/storyboards/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/lib/server/segment-references.ts"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/features/assets/CharacterDetailModal.tsx"),
  ]);
  assert.match(schema, /characterForms[\s\S]*description: text\("description"\)/);
  assert.match(schema, /export const characterFormReferences/);
  assert.match(platformSchema, /export const characterFormReferences/);
  assert.match(migration, /ALTER TABLE `character_forms` ADD `description` text DEFAULT '' NOT NULL/);
  assert.match(referenceMigration, /CREATE TABLE `character_form_references`/);
  assert.match(referenceMigration, /WHERE `asset_id` IS NOT NULL/);
  assert.match(extractRoute, /bind\(form\.description/);
  assert.match(generationSubmit, /generationEntityBelongsToProject/);
  assert.match(generationSubmit, /inArray\(generationJobs\.status/);
  assert.match(jobRoute, /latestVersionAssetId/);
  assert.match(jobRoute, /visualLocked: false/);
  assert.match(jobRoute, /entityType === "character_form"/);
  assert.match(jobRoute, /shotAssetReferences\.characterFormId/);
  assert.match(jobRoute, /replaceCharacterReferencePack/);
  assert.match(jobRoute, /characterReferenceType/);
  assert.match(jobRoute, /characterPrimaryIndex/);
  assert.match(jobRoute, /characterReferenceType\(item\.filename, index\) === "front"/);
  assert.match(jobRoute, /isPrimary: index === characterPrimaryIndex/);
  assert.match(jobRoute, /!currentCharacterAsset\?\.storageKey/);
  assert.doesNotMatch(jobRoute, /const existing = forms\[index\]/);
  assert.match(assetBatchRoute, /VISUAL_ASSET_WORKFLOWS_REQUIRED/);
  assert.match(assetBatchRoute, /visualAssetBatchItemGenerated/);
  assert.match(assetBatchModel, /referenceImageAssetId/);
  assert.match(assetBatchModel, /project_visual_asset_generation/);
  assert.match(assetBatchModel, /formHasReadyPack/);
  assert.match(assetBatchModel, /character_form_concept/);
  assert.match(assetBatchModel, /character_form_pack/);
  assert.doesNotMatch(assetBatchModel, /visualAssetApproved\(concept/);
  assert.match(assetBatchRunner, /submitGenerationJobForUser/);
  assert.match(assetBatchRunner, /runnerLeaseToken/);
  assert.match(productionTick, /runActiveVisualAssetBatches/);
  assert.match(segmentGenerateRoute, /characterFormReferences/);
  assert.match(segmentGenerateRoute, /buildGenerationReferencePayload/);
  assert.match(segmentReferences, /characterImageAssetIds/);
  assert.match(projectRoute, /characterFormReferences: projectCharacterFormReferences/);
  assert.match(storyboardRoute, /"prop", referenceOrder/);
  assert.match(storyboardRoute, /selectCharacterFormForShot/);
  assert.match(storyboardRoute, /character_form_id/);
  assert.match(storyboardRoute, /lockReadyProjectVisualAssets/);
  assert.match(storyboardRoute, /VISUAL_ASSETS_NOT_READY/);
  assert.match(approveRoute, /lockReadyProjectVisualAssets/);
  assert.match(approvalBatch, /listLockableVisualAssetIds/);
  assert.match(assetsPage, /一键确认/);
  assert.match(assetsPage, /确认全部并排分镜/);
  assert.match(assetApprovalRoute, /ASSET_MEDIA_REQUIRED/);
  assert.match(assetApprovalRoute, /updateVisualAssetApproval/);
  assert.match(productionPlanRoute, /referenceRole === "prop"/);
  assert.match(productionPlanRoute, /道具标准图尚未生成并锁定/);
  assert.match(assetsPage, /function VisualAssetModal/);
  assert.match(assetsPage, /CharacterDetailModal/);
  assert.match(characterDetailModal, /saveAndGenerateThreeView/);
  assert.match(characterDetailModal, /标准图包/);
  assert.match(characterDetailModal, /character-form-switcher/);
  assert.match(characterDetailModal, /上传概念图/);
  assert.match(characterDetailModal, /保存并生成三视图/);
  assert.match(characterDetailModal, /entityType: "character_form"/);
  assert.match(assetsPage, /formHasReadyAsset/);
  assert.match(assetsPage, /批量生成待完成资产/);
  assert.match(assetsPage, /visualBatch\?\.status === "running"/);
  assert.match(assetBatchModel, /referenceImageAssetId/);
  assert.match(assetsPage, /generatedVisualAssets < visualAssetTotal/);
  assert.match(assetsPage, /确认并锁定/);
  assert.match(assetsPage, /批量生成待完成资产/);
  assert.match(assetsPage, /findActiveGenerationJob/);
  assert.match(characterDetailModal, /已恢复进行中的生成任务/);
  assert.doesNotMatch(assetsPage, /setTimeout\([^)]*100/);
});

test("selects the episode-specific locked character form for downstream shots", async () => {
  const { selectCharacterFormForShot } = await import("../app/lib/character-form-selection.ts");
  const forms = [
    { id: "base", characterId: "c1", name: "基础形象", assetId: "a-base", episodeScopeJson: "[]" },
    { id: "rain", characterId: "c1", name: "雨衣形态", assetId: "a-rain", episodeScopeJson: "[2,3]" },
    { id: "wound", characterId: "c1", name: "受伤形态", assetId: "a-wound", episodeScopeJson: "[5]" },
  ];
  assert.equal(selectCharacterFormForShot(forms, 2, "人物进入旧楼")?.id, "rain");
  assert.equal(selectCharacterFormForShot(forms, 1, "人物进入旧楼")?.id, "base");
  assert.equal(selectCharacterFormForShot(forms, 2, "受伤形态的角色回头")?.id, "wound");

  const approval = await import("../app/lib/visual-asset-approval.ts");
  const locked = approval.updateVisualAssetApproval('{"description":"主角"}', true, "2026-07-22T00:00:00.000Z");
  assert.equal(approval.visualAssetApproved(locked), true);
  assert.equal(approval.visualAssetApproved(approval.updateVisualAssetApproval(locked, false)), false);
});

test("binds ComfyUI workflows and returns generated files to their shots", async () => {
  const [center, bindingsRoute, connectionRoute, libraryRoute, comfyAdapter, jobRoute, assetRoute, capabilities] = await Promise.all([
    read("../app/features/settings/SettingsModal.tsx"),
    read("../app/api/workflows/bindings/route.ts"),
    read("../app/api/workflows/connection-test/route.ts"),
    read("../app/api/workflows/spark-library/route.ts"),
    read("../app/lib/server/comfyui.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/assets/[assetId]/content/route.ts"),
    read("../app/lib/workflow-capabilities.ts"),
  ]);
  assert.match(center, /API 格式/);
  assert.match(center, /inputContract/);
  assert.match(center, /suggestInputContract/);
  assert.match(center, /选择 ComfyUI 工作流/);
  assert.match(bindingsRoute, /getMediaBucket\(\)\.put/);
  assert.match(bindingsRoute, /validateContracts/);
  assert.match(connectionRoute, /testComfyUiConnection/);
  assert.match(libraryRoute, /inspectStoredWorkflows/);
  assert.match(comfyAdapter, /userdata\?dir=workflows/);
  assert.match(comfyAdapter, /format: "editor"/);
  assert.match(jobRoute, /resolveWorkflowOutputs/);
  assert.match(jobRoute, /firstFrameAssetId/);
  assert.match(assetRoute, /getOwnedProject/);
  assert.match(capabilities, /characterImages/);
  assert.match(capabilities, /voiceReference/);
});

test("syncs versioned ComfyUI workflows and persists real node progress", async () => {
  const [bridgeExtension, bridgeFrontend, bridgeClient, bridgeRoute, progress, bindingRoute, schema, migration, center] = await Promise.all([
    read("../integrations/comfyui/xiaofeixiang_bridge/__init__.py"),
    read("../integrations/comfyui/xiaofeixiang_bridge/web/xiaofeixiang_bridge.js"),
    read("../app/lib/server/comfyui.ts"),
    read("../app/api/workflows/bridge/route.ts"),
    read("../app/lib/server/workflow-progress.ts"),
    read("../app/api/workflows/bindings/route.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0002_panoramic_nico_minoru.sql"),
    read("../app/features/settings/SettingsModal.tsx"),
  ]);
  assert.match(bridgeExtension, /workflows\/sync/);
  assert.match(bridgeExtension, /executions\/register/);
  assert.match(bridgeExtension, /send_sync_with_capture/);
  assert.match(bridgeExtension, /suggestedCapabilities/);
  assert.match(bridgeExtension, /image_to_video/);
  assert.match(bridgeExtension, /bridge\/preparations/);
  assert.match(bridgeExtension, /preparations\/next/);
  assert.match(bridgeFrontend, /prepareRequestedWorkflow/);
  assert.match(bridgeFrontend, /Math\.imul/);
  assert.doesNotMatch(bridgeFrontend, /crypto\.subtle/);
  assert.match(bridgeFrontend, /replace\(\/\^\\\*\+\//);
  assert.match(bridgeExtension, /max\(int\(execution\.get\("overallProgress"/);
  assert.match(bridgeClient, /registerBridgeExecution/);
  assert.match(bridgeClient, /multi_subject_video/);
  assert.match(bridgeClient, /first_last_frame_video/);
  assert.match(bridgeClient, /getBridgeExecution/);
  assert.match(bridgeRoute, /listBridgeWorkflows/);
  assert.match(bridgeRoute, /listStoredWorkflows/);
  assert.match(bridgeRoute, /registered[\s\S]*\.filter/);
  assert.match(bridgeRoute, /currentByName/);
  assert.match(bridgeRoute, /right\.updatedAt - left\.updatedAt/);
  assert.match(bridgeRoute, /staleWorkflowCount/);
  assert.match(progress, /workflowExecutionEvents/);
  assert.match(bindingRoute, /bridgeWorkflowId/);
  assert.doesNotMatch(bindingRoute, /WORKFLOW_ALREADY_BOUND/);
  assert.match(bindingRoute, /workflowVersions/);
  assert.match(schema, /workflowExecutionEvents/);
  assert.match(migration, /workflow_execution_events/);
  assert.match(center, /settings-test-node-line|testNodeProgress/);
  assert.match(center, /节点进度/);
  assert.match(center, /备用方式/);
  assert.match(center, /availableLibraryWorkflows/);
  assert.doesNotMatch(center, /occupiedWorkflowIds/);
  assert.match(center, /同一工作流可用于多个兼容方案/);
  assert.match(center, /workflow-picker/);
  assert.doesNotMatch(center, /可直接绑定|可选择/);
  assert.match(center, /selectLibraryWorkflow/);
});

test("admits only recently successful workflow tests into production routes", async () => {
  const [readiness, requirementsRoute, bindingRoute, generationSubmit, planRoute, workflowCenter] = await Promise.all([
    read("../app/lib/server/verified-workflows.ts"),
    read("../app/api/workflows/requirements/route.ts"),
    read("../app/api/workflows/bindings/route.ts"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/features/settings/SettingsModal.tsx"),
  ]);
  assert.match(readiness, /latestTestStatusByBindingId/);
  assert.match(readiness, /=== "succeeded"/);
  assert.match(requirementsRoute, /verifiedBindings/);
  assert.match(requirementsRoute, /latestTestStatus/);
  assert.match(bindingRoute, /status: "invalidated"/);
  assert.match(bindingRoute, /需要重新测试/);
  assert.match(generationSubmit, /getVerifiedWorkflowBinding/);
  assert.match(generationSubmit, /WORKFLOW_NOT_VERIFIED/);
  assert.match(planRoute, /readiness\.verifiedBindings/);
  assert.match(workflowCenter, /已验证/);
  assert.match(workflowCenter, /待测试/);
  assert.match(workflowCenter, /需重测/);
});

test("runs every bound workflow from tests and image-to-video from storyboard shots", async () => {
  const [testRoute, testStatusRoute, testOutputRoute, jobsRoute, editor, workflowCenter, migration, nextConfig] = await Promise.all([
    read("../app/api/workflows/bindings/[bindingId]/test/route.ts"),
    read("../app/api/workflows/test-runs/[runId]/route.ts"),
    read("../app/api/workflows/test-runs/[runId]/output/route.ts"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/settings/SettingsModal.tsx"),
    read("../drizzle/0001_safe_argent.sql"),
    read("../next.config.ts"),
  ]);
  assert.match(testRoute, /uploadWorkflowInput/);
  assert.match(testRoute, /queueWorkflow/);
  assert.match(testRoute, /form\.get\("_capability"\)/);
  assert.match(testRoute, /valueType === "imageList"/);
  assert.match(testRoute, /orderBy\(desc\(workflowTestRuns\.createdAt\)\)/);
  assert.match(testStatusRoute, /selectWorkflowOutput/);
  assert.match(testStatusRoute, /inspectMp4DurationSeconds/);
  assert.match(testStatusRoute, /WORKFLOW_VIDEO_TOO_SHORT/);
  assert.match(testStatusRoute, /workflowQueuePresence/);
  assert.match(testStatusRoute, /没有取得已归档的最终输出/);
  assert.match(testOutputRoute, /downloadWorkflowOutput/);
  assert.match(jobsRoute, /firstFrameAssetId/);
  assert.match(jobsRoute, /uploadWorkflowInput/);
  assert.match(editor, /只重做当前分镜/);
  assert.match(workflowCenter, /执行版已保存；请在下方完成一次真实测试/);
  assert.match(workflowCenter, /真实测试/);
  assert.match(workflowCenter, /selected\.inputs\.map/);
  assert.match(workflowCenter, /valueType === "imageList"/);
  assert.match(workflowCenter, /resolveWorkflowBinding/);
  assert.doesNotMatch(workflowCenter, /selectedKey === "image_to_video"/);
  assert.match(workflowCenter, /aria-live="polite"/);
  assert.match(workflowCenter, /testProgress/);
  assert.match(workflowCenter, /testFailed/);
  assert.match(workflowCenter, /readApiJson/);
  assert.match(workflowCenter, /semanticTitles/);
  assert.match(workflowCenter, /WORKFLOW_VIDEO_TOO_SHORT/);
  assert.match(testRoute, /15 \* 1024 \* 1024/);
  assert.match(nextConfig, /bodySizeLimit: "20mb"/);
  assert.match(migration, /CREATE TABLE `workflow_test_runs`/);
});

test("models complete drama production above replaceable workflow adapters", async () => {
  const [schema, platformSchema, domain, planner, routes, storyboardRoute, projectRoute, videosPage, editorPage, workflowCenter, requirementsRoute, migration, workflowCapabilities, workflowRouting, verifiedWorkflows, generationSubmit, productionPlan, contracts, generationDto, jobsRoute, bindingsRoute] = await Promise.all([
    read("../db/schema.ts"),
    read("../packages/database/src/schema.ts"),
    read("../packages/domain/src/production.ts"),
    read("../app/lib/production-planner.ts"),
    read("../app/lib/production-routes.ts"),
    read("../app/api/projects/[projectId]/storyboards/route.ts"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/settings/SettingsModal.tsx"),
    read("../app/api/workflows/requirements/route.ts"),
    read("../drizzle/0004_known_thunderbolt.sql"),
    read("../app/lib/workflow-capabilities.ts"),
    read("../app/lib/workflow-routing.ts"),
    read("../app/lib/server/verified-workflows.ts"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../packages/contracts/src/index.ts"),
    read("../apps/api/src/generation/dto/create-generation-job.dto.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/workflows/bindings/route.ts"),
  ]);
  for (const table of ["storyBibles", "storyScenes", "segments", "shotAssetReferences", "dialogueLines", "audioTracks", "shotVersions"]) {
    assert.match(schema, new RegExp(`export const ${table}`));
    assert.match(platformSchema, new RegExp(`export const ${table}`));
  }
  assert.match(domain, /resolveShotProductionPlan/);
  assert.match(domain, /resolveSegmentProductionPlan/);
  assert.match(domain, /lip_sync/);
  assert.match(planner, /resolveDomainShotProductionPlan/);
  assert.match(planner, /parallelGroups/);
  assert.match(routes, /visual_assets/);
  assert.match(routes, /segment_video/);
  assert.match(routes, /sound_enhancement/);
  assert.match(routes, /requiredCapabilities: \["native_audio_video"\]/);
  assert.match(routes, /requiredCapabilities: \["image_generation", "character_image"\]/);
  assert.match(routes, /requiredCapabilities: \["video_generation", "voice_synthesis", "lip_sync"\]/);
  assert.match(workflowCapabilities, /key: "image_generation"/);
  assert.match(workflowCapabilities, /key: "video_generation"/);
  assert.match(workflowRouting, /scene_image: \["image_generation"\]/);
  assert.match(jobsRoute, /resolveWorkflowOutputs/);
  assert.match(bindingsRoute, /collectAllImages/);
  assert.doesNotMatch(workflowRouting, /multi_subject_video: \["video_generation"\]/);
  assert.match(await read("../app/lib/production-routing-rules.ts"), /多人镜头 → 图生视频/);
  assert.doesNotMatch(workflowRouting, /image_to_video: \["video_generation"\]/);
  assert.match(workflowRouting, /effectiveVerifiedCapabilities/);
  assert.match(workflowRouting, /scoreWorkflowBindingForPayload/);
  assert.match(workflowRouting, /resolveWorkflowBinding/);
  assert.match(workflowRouting, /payloadWantsStoryboardReferences/);
  assert.match(workflowRouting, /return -100/);
  assert.match(verifiedWorkflows, /resolveWorkflowBinding/);
  assert.match(generationSubmit, /getVerifiedWorkflowBinding\(ownerId, capability, input\.payload/);
  assert.match(productionPlan, /referenceWiring/);
  assert.match(productionPlan, /bindingAcceptsStoryboardReferences/);
  assert.match(contracts, /"image_generation"/);
  assert.match(contracts, /"video_generation"/);
  assert.match(generationDto, /"image_generation", "video_generation"/);
  assert.match(storyboardRoute, /automaticallyResolved: true/);
  assert.doesNotMatch(storyboardRoute, /const strategy = shotDraft\.dialogue/);
  assert.match(requirementsRoute, /loadMainlineReadiness/);
  assert.match(requirementsRoute, /mainline,/);
  assert.match(requirementsRoute, /legacyRedirect/);
  assert.match(workflowCenter, /settingsMenuSections/);
  assert.match(workflowCenter, /创作主线能力配置/);
  assert.match(workflowCenter, /主线步骤/);
  assert.match(workflowCenter, /settings-submenu-heading/);
  assert.match(workflowCenter, /routingRuleGroups/);
  assert.match(workflowCenter, /settings-modal/);
  assert.doesNotMatch(workflowCenter, /StudioShell/);
  assert.match(storyboardRoute, /StructuredDramaAnalysis/);
  assert.doesNotMatch(storyboardRoute, /createProductionSegments/);
  assert.match(projectRoute, /shotAssetReferences/);
  assert.match(projectRoute, /dialogueLines/);
  assert.match(videosPage, /个片段/);
  assert.match(editorPage, /本片段怎么生成/);
  assert.match(editorPage, /internalBlockers/);
  assert.match(editorPage, /固定音色配音＋口型同步/);
  assert.match(migration, /CREATE TABLE `segments`/);
  assert.match(migration, /CREATE TABLE `audio_tracks`/);
});

test("produces a multi-shot segment through unified or stitched durable production", async () => {
  const [schema, platformSchema, migration, generationSubmit, segmentPrompt, generateRoute, planRoute, jobRoute, projectRoute, editor, workbenchParts, versionRoute, videos] = await Promise.all([
    read("../db/schema.ts"),
    read("../packages/database/src/schema.ts"),
    read("../drizzle/0007_opposite_lightspeed.sql"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/lib/server/segment-prompt.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/editor/SegmentWorkbenchParts.tsx"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/versions/[versionId]/route.ts"),
    read("../app/features/videos/VideosPage.tsx"),
  ]);
  assert.match(schema, /export const segmentVersions/);
  assert.match(schema, /videoAssetId: text\("video_asset_id"\)/);
  assert.match(platformSchema, /export const segmentVersions/);
  assert.match(migration, /CREATE TABLE `segment_versions`/);
  assert.match(generationSubmit, /entityType === "segment"/);
  assert.match(generateRoute, /buildSegmentPrompt/);
  assert.match(segmentPrompt, /必须在一个连续视频中完整执行以下所有分镜/);
  assert.match(planRoute, /promptPreview: buildSegmentPrompt/);
  assert.match(generateRoute, /stage: "first_frame"/);
  assert.match(generateRoute, /awaiting_frame_review/);
  assert.match(generateRoute, /confirmFrames/);
  assert.match(generateRoute, /regenFrames/);
  assert.match(generateRoute, /entityType: "segment"/);
  assert.match(generateRoute, /resumeRequired/);
  assert.match(generateRoute, /stage: "shot_video"/);
  assert.match(generateRoute, /需要完成对白配音/);
  assert.match(generateRoute, /videoCapability = "image_to_video"/);
  assert.match(generateRoute, /composeEpisodeVideos/);
  assert.match(generateRoute, /import \{ waitUntil \} from "cloudflare:workers"/);
  assert.match(generateRoute, /waitUntil\(\(async \(\) =>/);
  assert.match(generateRoute, /stage: "compose"[\s\S]+status: 202/);
  assert.match(generateRoute, /productionMode: "stitched_shots"/);
  assert.match(generationSubmit, /characterImageAssetIds/);
  assert.match(planRoute, /"unified_segment" : "stitched_shots"/);
  assert.match(planRoute, /capability: "segment_compose"/);
  assert.match(planRoute, /missingCapabilityDetails/);
  assert.doesNotMatch(planRoute, /片段合成器尚未接通/);
  assert.match(jobRoute, /db\.insert\(segmentVersions\)/);
  assert.match(jobRoute, /setCurrentSegmentVersion/);
  assert.match(projectRoute, /segmentVersions: projectSegmentVersions/);
  assert.match(editor, /submitSegmentGeneration/);
  assert.match(editor, /已恢复片段生成任务/);
  assert.match(editor, /立即生成/);
  assert.match(editor, /将生成本片段/);
  assert.match(editor, /skylark-editor/);
  assert.match(editor, /合成全集/);
  assert.match(workbenchParts, /片段候选版本/);
  assert.match(workbenchParts, /采用此版本/);
  assert.match(workbenchParts, /整段生成指令（高级）/);
  assert.match(workbenchParts, /本片段会带上的参考图/);
  assert.match(workbenchParts, /SegmentShotProductionPanel/);
  assert.match(workbenchParts, /SegmentAssetSidebar/);
  assert.match(workbenchParts, /SegmentPromptCanvas/);
  assert.match(workbenchParts, /SegmentPhonePreview/);
  assert.match(workbenchParts, /输入 @ 引用资产及工具/);
  assert.match(workbenchParts, /还没有成片/);
  assert.match(workbenchParts, /右侧只显示成片|首帧会出现在下方/);
  assert.match(workbenchParts, /本集片段/);
  assert.match(workbenchParts, /点选切换要生成的片段/);
  assert.match(workbenchParts, /重做当前|全部重做|生成全部首帧/);
  assert.match(workbenchParts, /skylark-frame-lightbox/);
  assert.match(workbenchParts, /本片段分镜首帧/);
  assert.match(editor, /framePreviewByShotId/);
  assert.match(editor, /改左侧参考会清空/);
  assert.match(editor, /buildSegmentReferences/);
  assert.match(editor, /episodeReferenceKeys/);
  assert.match(editor, /toggleSegmentReference/);
  assert.match(generateRoute, /parallelJob/);
  assert.match(generateRoute, /voice_synthesis/);
  assert.match(planRoute, /parallelVoiceStepId/);
  assert.match(generationSubmit, /WORKFLOW_INPUT_REFERENCE_MISSING/);
  assert.match(editor, /openSettingsForPlanGap/);
  assert.match(editor, /parallelGenerationJobId/);
  assert.match(workbenchParts, /打开设置/);
  assert.match(versionRoute, /SEGMENT_BUSY/);
  assert.match(versionRoute, /setCurrentSegmentVersion/);
  assert.match(versionRoute, /assetId: asset\.id/);
  assert.match(editor, /previewSegmentVersionAssetId/);
  assert.match(generateRoute, /resolveShotVideoCapability/);
  assert.match(generateRoute, /buildShotVideoJobPayload/);
  assert.match(planRoute, /resolveShotVideoCapability/);
  assert.match(planRoute, /first_last_frame_video/);
  assert.match(jobRoute, /frameRole === "lastFrame"/);
  assert.match(workbenchParts, /视频生成方式/);
  assert.match(editor, /saveVideoCapability/);
  assert.match(videos, /片段视频 \$\{readySegments\}/);
});

test("honors creator-selected shot video capabilities through plan and execution", async () => {
  const [shotVideoCapability, generateRoute, planRoute, jobsRoute, shotRoute, editor, workflowRouting] = await Promise.all([
    read("../app/lib/shot-video-capability.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/generation/jobs/route.ts"),
    read("../app/api/projects/[projectId]/shots/[shotId]/route.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/lib/workflow-routing.ts"),
  ]);
  assert.match(shotVideoCapability, /videoCapability/);
  assert.match(shotVideoCapability, /lastFrameAssetId/);
  assert.match(shotVideoCapability, /resolveShotVideoCapability/);
  assert.match(shotVideoCapability, /first_last_frame_video/);
  assert.match(generateRoute, /capability: videoCapability/);
  assert.match(planRoute, /shotVideoGenerationBlockers/);
  assert.match(jobsRoute, /readShotVideoCapabilitySelection/);
  assert.match(shotRoute, /videoCapability: ShotVideoCapability/);
  assert.match(editor, /shotVideoCapabilityOptions/);
  assert.doesNotMatch(workflowRouting, /first_last_frame_video: \["video_generation"\]/);
  assert.doesNotMatch(workflowRouting, /multi_subject_video: \["video_generation"\]/);
  assert.match(await read("../app/lib/production-routing-rules.ts"), /多人镜头 → 图生视频/);
});

test("keeps a Toonflow-style editable segment track prompt and directed canvas layout", async () => {
  const [segmentSchema, segmentPrompt, segmentRoute, planRoute, generateRoute, editor, workbenchParts, canvas, packageJson] = await Promise.all([
    read("../db/schema.ts"),
    read("../app/lib/server/segment-prompt.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/editor/SegmentWorkbenchParts.tsx"),
    read("../app/features/canvas/CanvasWorkspace.tsx"),
    read("../package.json"),
  ]);
  assert.match(segmentSchema, /directorPrompt: text\("director_prompt"\)/);
  assert.match(segmentPrompt, /if \(manualPrompt\) return manualPrompt/);
  assert.match(segmentRoute, /directorPrompt\.trim\(\)\.slice\(0, 30_000\)/);
  assert.match(planRoute, /promptSource: segment\.directorPrompt/);
  assert.match(generateRoute, /buildSegmentPrompt\(segment, segmentShots, lines\)/);
  assert.match(editor, /saveSegmentDirectorPrompt/);
  assert.match(editor, /有未保存修改/);
  assert.match(workbenchParts, /恢复自动指令/);
  assert.match(canvas, /runDagreLayout\(graph\)/);
  assert.match(canvas, /rankdir: "LR"/);
  assert.match(canvas, /referencedNodeRuntime/);
  assert.match(canvas, /setInterval\(\(\) =>/);
  assert.match(canvas, /刷新状态/);
  assert.match(canvas, /onConnectStart/);
  assert.match(canvas, /断开 \$\{String\(edge\.label/);
  assert.match(packageJson, /@dagrejs\/dagre/);
});

test("persists segment reference selections and submits the same inputs through every generation path", async () => {
  const [schema, referencesRoute, referenceHelper, segmentGenerate, directGenerate, submitter, editor, workbenchParts] = await Promise.all([
    read("../db/schema.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/references/route.ts"),
    read("../app/lib/server/segment-references.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/generation/jobs/route.ts"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/editor/SegmentWorkbenchParts.tsx"),
  ]);
  assert.match(schema, /referenceMode: text\("reference_mode"\)/);
  assert.match(schema, /segmentAssetReferences = sqliteTable\("segment_asset_references"/);
  assert.match(referencesRoute, /mode === "automatic"/);
  assert.match(referencesRoute, /invalidateGeneratedOutputs/);
  assert.match(referencesRoute, /REFERENCE_NOT_IN_PROJECT/);
  assert.match(referenceHelper, /referencesForShot/);
  assert.match(referenceHelper, /buildShotReferenceContext/);
  assert.match(referenceHelper, /storyboard per-shot refs win per role|inferCatalogCharacterRefs|characterCatalog/);
  assert.match(referenceHelper, /mappedShotRefs/);
  assert.match(await read("../app/lib/character-mention.ts"), /characterNameMentionedInText/);
  assert.match(await read("../app/features/editor/segment-workbench.ts"), /characterNameMentionedInText/);
  assert.match(referenceHelper, /characterImageAssetIds/);
  assert.match(referenceHelper, /propImageAssetIds/);
  assert.match(referenceHelper, /One primary portrait per character|分镜\/托盘绑定的主图优先/);
  assert.match(segmentGenerate, /shotReferenceContext/);
  assert.match(segmentGenerate, /buildShotReferenceContext/);
  assert.match(directGenerate, /buildShotReferenceContext/);
  assert.match(submitter, /idsKey: "propImageAssetIds", inputKey: "propImages"/);
  assert.match(editor, /saveSegmentReferences/);
  assert.match(editor, /confirmFrames/);
  assert.match(editor, /regenFrames/);
  assert.match(editor, /确认首帧并生成视频/);
  assert.match(workbenchParts, /调整参考/);
  assert.match(workbenchParts, /保存并应用/);
  assert.match(workbenchParts, /首帧全部就绪后需你确认/);
  assert.match(workbenchParts, /本镜生成会用|本段有 · 本镜不用/);
  assert.match(workbenchParts, /skylark-frame-ref-labels/);
  assert.match(workbenchParts, /referenceLabels/);
  assert.match(editor, /shotGenerationReferenceKeys/);
  assert.match(editor, /activeShotKeys/);
  assert.match(editor, /referenceWiring/);
  assert.match(editor, /openSettings\("image", "storyboard_frame"\)/);
  assert.match(workbenchParts, /运镜库/);
  assert.match(workbenchParts, /CameraMoveLibrary/);
  assert.match(workbenchParts, /按每个分镜自动带出场角色|当前分镜工作流还没接参考图口子|本镜参考图/);
  assert.match(editor, /配音还差一步/);
  assert.match(editor, /去锁定音色/);
  assert.match(editor, /skylark-status-banner/);
});

test("turns a direct shot repair into a recomposable segment without discarding untouched shots", async () => {
  const [state, resultRoute, segmentRoute, editor] = await Promise.all([
    read("../app/lib/server/production-state.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/features/editor/EditorPage.tsx"),
  ]);
  assert.match(state, /invalidateSegmentCurrentOutput/);
  assert.match(state, /currentVersionNumber: 0/);
  assert.match(state, /videoAssetId: null/);
  assert.doesNotMatch(state, /delete\(shotVersions\)|delete\(segmentVersions\)/);
  assert.match(resultRoute, /jobPayload\.segmentPipeline !== true/);
  assert.match(resultRoute, /invalidateSegmentCurrentOutput/);
  assert.match(resultRoute, /directRepair \? \{ videoAssetId: null \}/);
  assert.match(segmentRoute, /segmentPipeline: true/);
  assert.match(segmentRoute, /resumeRequired:[^\n]+\["preparing", "generating", "generating_shots", "composing"\]/);
  assert.doesNotMatch(segmentRoute, /resumeRequired:[^\n]+!segment\.videoAssetId/);
  assert.match(editor, /force: Boolean\(selectedSegment\?\.videoAssetId\)/);
  assert.match(editor, /重新生成/);
  assert.match(editor, /当前分镜结果已更新，请重新生成片段以建立新候选版本/);
});

test("coordinates resumable episode-wide segment production without hiding per-segment failures", async () => {
  const [route, runner, internalTick, worker, devScript, videos] = await Promise.all([
    read("../app/api/projects/[projectId]/episodes/[episodeId]/produce/route.ts"),
    read("../app/lib/server/episode-batch-runner.ts"),
    read("../app/api/internal/production/tick/route.ts"),
    read("../worker/index.ts"),
    read("../scripts/dev.mjs"),
    read("../app/features/videos/VideosPage.tsx"),
  ]);
  assert.match(route, /episode_segment_production/);
  assert.match(route, /insert\(mediaJobs\)/);
  assert.match(route, /attemptedSegmentIds/);
  assert.match(route, /requiresVoice/);
  assert.match(route, /requiresAmbience/);
  assert.match(route, /segment\.status === "video_audio_ready"/);
  assert.match(route, /action !== "advance"/);
  assert.match(route, /action === "fail"/);
  assert.match(route, /action === "cancel"/);
  assert.match(runner, /runEpisodeBatchStep/);
  assert.match(runner, /syncGenerationJobRoute/);
  assert.match(runner, /submitSegmentRoute/);
  assert.match(runner, /confirmFrames: true/);
  assert.match(runner, /submitSoundRoute/);
  assert.match(runner, /runActiveEpisodeBatches/);
  assert.match(runner, /claimBatch/);
  assert.match(runner, /runnerLeaseToken/);
  assert.match(runner, /eq\(mediaJobs\.payloadJson, batch\.payloadJson\)/);
  assert.match(runner, /releaseBatch/);
  assert.match(internalTick, /BATCH_RUNNER_TOKEN/);
  assert.match(internalTick, /runActiveEpisodeBatches/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /api\/internal\/production\/tick/);
  assert.match(devScript, /dev:batch/);
  assert.match(videos, /批量生成待完成片段/);
  assert.match(videos, /已恢复上次未完成的分集生产批次/);
  assert.match(videos, /api\/generation\/jobs/);
  assert.match(videos, /后台执行器正在准备片段视频/);
  assert.match(videos, /本集全部片段已完成，可以逐片段审片并合成整集/);
});

test("reports whether independent background production services are truly alive", async () => {
  const [schema, platformSchema, heartbeat, reconciler, tick, runner, worker, runtimeRoute, mediaClient, panel, packageJson] = await Promise.all([
    read("../db/schema.ts"),
    read("../packages/database/src/schema.ts"),
    read("../app/lib/server/runtime-heartbeats.ts"),
    read("../app/lib/server/generation-job-reconciler.ts"),
    read("../app/api/internal/production/tick/route.ts"),
    read("../scripts/production-runner.mjs"),
    read("../worker/index.ts"),
    read("../app/api/engine/runtime/route.ts"),
    read("../app/lib/server/media-worker.ts"),
    read("../app/features/settings/EngineConnectionsPanel.tsx"),
    read("../package.json"),
  ]);
  assert.match(schema, /runtimeHeartbeats = sqliteTable\("runtime_heartbeats"/);
  assert.match(platformSchema, /runtimeHeartbeats = pgTable\("runtime_heartbeats"/);
  assert.match(heartbeat, /onConflictDoUpdate/);
  assert.match(heartbeat, /details\.mode === "scheduled" \? 120_000 : 20_000/);
  assert.match(reconciler, /inArray\(generationJobs\.status, activeStatuses\)/);
  assert.match(reconciler, /syncGenerationJobRoute/);
  assert.match(reconciler, /creator.*leave|离开原页面|independently of the page/s);
  assert.match(tick, /recordRuntimeHeartbeat/);
  assert.match(tick, /runActiveGenerationJobs/);
  assert.match(tick, /generationJobs\.active \+ episodes\.active \+ visualAssets\.active/);
  assert.match(runner, /x-runner-instance/);
  assert.match(runner, /x-runner-mode": "continuous"/);
  assert.match(worker, /x-runner-mode": "scheduled"/);
  assert.match(runtimeRoute, /testMediaWorkerConnection/);
  assert.match(runtimeRoute, /readRuntimeHeartbeat\("production-runner"\)/);
  assert.match(mediaClient, /\/health/);
  assert.match(panel, /api\/engine\/runtime/);
  assert.match(panel, /批次执行器/);
  assert.match(panel, /FFmpeg 媒体处理器/);
  assert.match(panel, /npm run dev/);
  assert.match(packageJson, /"dev": "node scripts\/dev\.mjs"/);
});

test("shows only persisted account assets and opens their real projects", async () => {
  const [route, page, studio, shell] = await Promise.all([
    read("../app/api/assets/route.ts"),
    read("../app/features/assets/GlobalAssets.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/components/layout/StudioShell.tsx"),
  ]);
  assert.match(route, /innerJoin\(projects/);
  assert.match(route, /eq\(projects\.ownerId, user\.id\)/);
  assert.match(page, /fetch\("\/api\/assets"/);
  assert.match(page, /onOpenProject\(asset\.project/);
  assert.doesNotMatch(page, /roleImages|sceneImages|林微|陈屹|张曼|王老师/);
  assert.match(studio, /onOpenProject=\{openProject\}/);
  assert.doesNotMatch(shell, /button disabled/);
});

test("keeps visual assets in distinct pending, review, and locked states", async () => {
  const assetsPage = await read("../app/features/assets/AssetsPage.tsx");
  assert.match(assetsPage, /type AssetFilter = "all" \| "pending" \| "review" \| "locked"/);
  assert.match(assetsPage, /function visualAssetState/);
  assert.match(assetsPage, /const reviewVisualAssets = generatedVisualAssets - readyVisualAssets/);
  assert.match(assetsPage, /const pendingVisualAssets = visualAssetTotal - generatedVisualAssets/);
  assert.match(assetsPage, />待确认 \{currentTabStateCounts\.review\}</);
  assert.match(assetsPage, /visibleProps\.map/);
  assert.match(assetsPage, /`待生成 \$\{pendingVisualAssets\} · 已出图 \$\{generatedVisualAssets\}\/\$\{visualAssetTotal\}/);
});

test("requires locked visual assets and invalidates every dependent current output after regeneration", async () => {
  const [approval, productionState, assetRoute, resultRoute, directJobRoute, planRoute, generateRoute, referencesRoute, workbench, editor] = await Promise.all([
    import("../app/lib/visual-asset-approval.ts"),
    read("../app/lib/server/production-state.ts"),
    read("../app/api/projects/[projectId]/assets/[assetId]/route.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/generation/jobs/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/references/route.ts"),
    read("../app/features/editor/segment-workbench.ts"),
    read("../app/features/editor/EditorPage.tsx"),
  ]);
  const media = { status: "ready", storageKey: "generated/scene.png", metadataJson: "{}" };
  assert.equal(approval.visualAssetMediaReady(media), true);
  assert.equal(approval.visualAssetProductionReady(media), false);
  assert.equal(approval.visualAssetProductionReady({ ...media, metadataJson: '{"visualLocked":true}' }), true);
  assert.match(productionState, /invalidateVisualDependencyOutputs/);
  assert.match(productionState, /firstFrameAssetId: null, videoAssetId: null/);
  assert.match(productionState, /segmentsWithProducedPointers/);
  assert.match(productionState, /else await db\.update\(segments\)\.set\(\{ status: "draft"/);
  assert.match(productionState, /segmentAssetReferences/);
  assert.match(assetRoute, /invalidateVisualDependencyOutputs/);
  assert.match(resultRoute, /outputContract\.mediaType === "image"/);
  assert.match(resultRoute, /invalidateVisualDependencyOutputs/);
  assert.match(directJobRoute, /当前分镜引用的角色、场景或道具必须先生成并锁定/);
  assert.match(directJobRoute, /visualAssetProductionReady/);
  assert.match(planRoute, /visualAssetProductionReady/);
  assert.match(generateRoute, /片段引用的角色、场景或道具必须先生成并锁定/);
  assert.match(referencesRoute, /visualAssetProductionReady/);
  assert.match(workbench, /visualAssetApproved/);
  assert.match(editor, /shotFrameRepairBlocked/);
  assert.match(editor, /请先补齐并锁定当前片段引用的角色、场景和道具/);
});

test("shows real project media and opens the selected episode in production", async () => {
  const [assetsPage, studio, videosPage, editorPage] = await Promise.all([
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../app/features/editor/EditorPage.tsx"),
  ]);
  assert.match(assetsPage, /materialAssets\.map/);
  assert.match(assetsPage, /function MaterialPreviewModal/);
  assert.match(assetsPage, /<video controls preload="metadata"/);
  assert.match(assetsPage, /<audio controls preload="metadata"/);
  assert.doesNotMatch(assetsPage, /tab === "素材" && <AssetEmpty/);
  assert.match(studio, /activeEpisodeId/);
  assert.match(studio, /onOpenEditor=\{openEpisodeEditor\}/);
  assert.match(videosPage, /onOpenEditor\(episode\.id\)/);
  assert.match(editorPage, /initialEpisodeId/);
  assert.match(editorPage, /shot\.episodeId === resolvedEpisodeId/);
  assert.match(editorPage, /当前分集/);
});

test("runs conditional dialogue, reusable ambience, lip sync, and internal FFmpeg media tasks", async () => {
  const [schema, migration, submit, resultRoute, planRoute, soundRoute, mediaClient, mediaWorker, editor, storyboardRoute, soundInvalidation, characterRoute, presetRoute] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0009_violet_venom.sql"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/production-plan/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/sound/route.ts"),
    read("../app/lib/server/media-worker.ts"),
    read("../apps/media-worker/src/main.mjs"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/api/projects/[projectId]/storyboards/route.ts"),
    read("../app/lib/server/sound-invalidation.ts"),
    read("../app/api/projects/[projectId]/characters/[characterId]/route.ts"),
    read("../app/api/projects/[projectId]/audio-presets/route.ts"),
  ]);
  assert.match(schema, /voiceReferenceAssetId/);
  assert.match(schema, /audioAssetId/);
  assert.match(schema, /export const mediaJobs/);
  assert.match(migration, /UPDATE `dialogue_lines` SET `voice_reference_asset_id`/);
  assert.match(submit, /entityType === "dialogue_line"/);
  assert.match(submit, /voiceReferenceAssetId/);
  assert.match(submit, /videoAssetId/);
  assert.match(resultRoute, /dialogue_audio/);
  assert.match(resultRoute, /trackType: "dialogue"/);
  assert.match(resultRoute, /capability === "ambient_audio"/);
  assert.match(resultRoute, /jobPayload\.audioPresetId/);
  assert.match(resultRoute, /update\(audioPresets\).*assetId/s);
  assert.match(resultRoute, /matchingTracks\.slice\(1\)/);
  assert.match(planRoute, /voice_synthesis/);
  assert.match(planRoute, /lip_sync/);
  assert.match(soundRoute, /submitGenerationJobForUser/);
  assert.match(soundRoute, /mixAudioTracks/);
  assert.match(soundRoute, /muxVideoAndAudio/);
  assert.match(soundRoute, /import \{ waitUntil \} from "cloudflare:workers"/);
  assert.match(soundRoute, /waitUntil\(\(async \(\) =>/);
  assert.match(soundRoute, /lastFailure/);
  assert.match(soundRoute, /!activeMediaJob && !lastFailure/);
  assert.match(soundRoute, /VOICE_LOCK_REQUIRED/);
  assert.match(soundRoute, /segmentShots\.flatMap\(\(shot\) => shot\.environmentPresetId/);
  assert.match(soundRoute, /usePresetAssetForSegment/);
  assert.match(soundRoute, /missingAmbiencePresets/);
  assert.match(soundRoute, /Math\.max\(30, Math\.ceil\(window\.durationMs/);
  assert.match(soundRoute, /loop: track\.trackType === "ambience"/);
  assert.match(mediaClient, /MEDIA_WORKER_URL/);
  assert.match(mediaClient, /loop: track\.loop === true/);
  assert.match(mediaWorker, /\/mix-audio/);
  assert.match(mediaWorker, /\/mux-video-audio/);
  assert.match(mediaWorker, /amix/);
  assert.match(mediaWorker, /-stream_loop/);
  assert.match(mediaWorker, /atrim=duration/);
  assert.match(storyboardRoute, /segmentDuration, -600/);
  assert.doesNotMatch(storyboardRoute, /shotId, "ambience", environmentPresetId/);
  assert.match(soundInvalidation, /invalidateEnvironmentPresetSound/);
  assert.match(soundInvalidation, /invalidateCharacterVoice/);
  assert.match(soundInvalidation, /audioAssetId: null/);
  assert.match(characterRoute, /invalidateCharacterVoice/);
  assert.match(presetRoute, /invalidateEnvironmentPresetSound/);
  assert.match(editor, /requestSegmentSound/);
  assert.match(editor, /已恢复片段声音任务/);
  assert.match(editor, /重试声音处理/);
});

test("renders a versioned episode video and downloadable subtitle sidecar from completed segments", async () => {
  const [schema, migration, projectRoute, renderRoute, mediaClient, mediaWorker, videosPage] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0010_bitter_raider.sql"),
    read("../app/api/projects/[projectId]/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
    read("../app/lib/server/media-worker.ts"),
    read("../apps/media-worker/src/main.mjs"),
    read("../app/features/videos/VideosPage.tsx"),
  ]);
  assert.match(schema, /export const episodeVersions/);
  assert.match(schema, /currentVersionNumber/);
  assert.match(migration, /CREATE TABLE `episode_versions`/);
  assert.match(projectRoute, /episodeVersions: projectEpisodeVersions/);
  assert.match(renderRoute, /EPISODE_SEGMENTS_INCOMPLETE/);
  assert.match(renderRoute, /composeEpisodeVideos/);
  assert.match(renderRoute, /application\/x-subrip/);
  assert.match(renderRoute, /burnEpisodeSubtitles/);
  assert.match(renderRoute, /subtitlesBurned/);
  assert.match(renderRoute, /insert\(episodeVersions\)/);
  assert.match(renderRoute, /operation: "episode_render"/);
  assert.match(mediaClient, /composeEpisodeVideos/);
  assert.match(mediaClient, /burnEpisodeSubtitles/);
  assert.match(mediaWorker, /\/compose-videos/);
  assert.match(mediaWorker, /\/burn-subtitles/);
  assert.match(mediaWorker, /force_style/);
  assert.match(mediaWorker, /normalized-/);
  assert.match(videosPage, /合成整集并导出/);
  assert.match(videosPage, /短剧醒目/);
  assert.match(videosPage, /烧录字幕/);
  assert.match(videosPage, /下载当前版本字幕/);
  assert.match(videosPage, /下载当前版本成片/);
});

test("keeps long episode renders and project deliveries alive beyond the submitting request", async () => {
  const [renderRoute, renderSelection, exportRoute, videosPage] = await Promise.all([
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
    read("../app/lib/episode-render-selection.ts"),
    read("../app/api/projects/[projectId]/export/route.ts"),
    read("../app/features/videos/VideosPage.tsx"),
  ]);
  assert.match(renderRoute, /import \{ waitUntil \} from "cloudflare:workers"/);
  assert.match(renderRoute, /waitUntil\(\(async \(\) =>/);
  assert.match(renderRoute, /status: "running", progress: 5[\s\S]+status: 202/);
  assert.match(renderRoute, /EPISODE_INPUTS_CHANGED/);
  assert.match(renderRoute, /latestVersion\?\.versionNumber/);
  assert.match(renderRoute, /orderCurrentEpisodeShots/);
  assert.match(renderRoute, /segmentSelections/);
  assert.doesNotMatch(renderRoute, /where\(eq\(shots\.episodeId, episodeId\)\)\.orderBy\(shots\.sequence\)/);
  assert.match(renderSelection, /segment sequence followed by shot sequence/);
  assert.match(renderSelection, /versionNumber/);
  assert.match(exportRoute, /import \{ waitUntil \} from "cloudflare:workers"/);
  assert.match(exportRoute, /waitUntil\(\(async \(\) =>/);
  assert.match(exportRoute, /PROJECT_EXPORT_INPUTS_CHANGED/);
  assert.match(exportRoute, /整剧交付任务已提交，可关闭页面后稍后继续下载/);
  assert.match(videosPage, /renderPollTick/);
  assert.match(videosPage, /整集合成任务已提交，可关闭页面后继续查看/);
  assert.match(videosPage, /整剧交付包已生成，可以下载/);
});

test("recovers interrupted generation and media tasks without permanent running states", async () => {
  const [recovery, submit, comfy, jobRoute, segmentRoute, soundRoute, renderRoute, videosPage, exampleEnv] = await Promise.all([
    read("../app/lib/server/media-job-recovery.ts"),
    read("../app/lib/server/generation-submit.ts"),
    read("../app/lib/server/comfyui.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/sound/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../.dev.vars.example"),
  ]);
  assert.match(recovery, /MEDIA_JOB_INTERRUPTED/);
  assert.match(recovery, /mediaJobLeaseMs/);
  assert.match(recovery, /compose_failed/);
  assert.match(recovery, /markEpisodeRenderFailed/);
  assert.match(exampleEnv, /MEDIA_JOB_LEASE_MS=1800000/);
  assert.match(submit, /GENERATION_SUBMIT_INTERRUPTED/);
  assert.match(comfy, /workflowQueuePresence/);
  assert.match(jobRoute, /COMFYUI_TASK_LOST/);
  assert.match(jobRoute, /GENERATION_SUBMIT_INTERRUPTED/);
  assert.match(jobRoute, /job\.status === "submitting"/);
  assert.match(jobRoute, /markSegmentGenerationFailed/);
  assert.match(jobRoute, /markRelatedSegmentGenerationFailed/);
  assert.match(jobRoute, /payload\.segmentPipeline !== true/);
  assert.match(jobRoute, /shot\?\.segmentId/);
  assert.match(segmentRoute, /recoverInterruptedMediaJobs/);
  assert.match(segmentRoute, /activeComposeJob/);
  assert.match(segmentRoute, /lastFailure/);
  assert.doesNotMatch(segmentRoute, /resumeRequired:[^\n]+generation_failed/);
  assert.match(soundRoute, /recoverInterruptedMediaJobs/);
  assert.match(renderRoute, /recoverInterruptedMediaJobs/);
  assert.match(videosPage, /已恢复整集合成任务/);
  assert.match(videosPage, /selectedEpisodeVersions/);
  assert.match(videosPage, /segmentItem\.currentVersionNumber/);
  assert.match(videosPage, /下载当前版本成片/);
  const editor = await read("../app/features/editor/EditorPage.tsx");
  assert.match(editor, /正在恢复片段合成任务/);
  assert.match(editor, /正在恢复片段声音合成/);
});

test("orders only current-revision shots and snapshots exact segment versions for episode render", async () => {
  const { orderCurrentEpisodeShots, buildEpisodeRenderSnapshot, episodeRenderSnapshotMatches } = await import("../app/lib/episode-render-selection.ts");
  const segments = [
    { id: "segment-b", sequence: 2, currentVersionNumber: 4, videoAssetId: "video-b" },
    { id: "segment-a", sequence: 1, currentVersionNumber: 2, videoAssetId: "video-a" },
  ];
  const ordered = orderCurrentEpisodeShots(segments, [
    { id: "old-shot", segmentId: "old-segment", sequence: 1 },
    { id: "b-2", segmentId: "segment-b", sequence: 2 },
    { id: "a-2", segmentId: "segment-a", sequence: 2 },
    { id: "b-1", segmentId: "segment-b", sequence: 1 },
    { id: "a-1", segmentId: "segment-a", sequence: 1 },
  ]);
  assert.deepEqual(ordered.map((shot) => shot.id), ["a-1", "a-2", "b-1", "b-2"]);
  const snapshot = buildEpisodeRenderSnapshot(segments);
  assert.deepEqual(snapshot.map((item) => [item.segmentId, item.versionNumber, item.assetId]), [
    ["segment-a", 2, "video-a"],
    ["segment-b", 4, "video-b"],
  ]);
  assert.equal(episodeRenderSnapshotMatches(snapshot, snapshot), true);
  assert.equal(episodeRenderSnapshotMatches(buildEpisodeRenderSnapshot([{ ...segments[1], currentVersionNumber: 3 }, segments[0]]), snapshot), false);
});

test("rejects empty or severely short production videos before durable success", async () => {
  const [jobRoute, segmentRoute, episodeRoute] = await Promise.all([
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
  ]);
  assert.match(jobRoute, /WORKFLOW_VIDEO_INVALID/);
  assert.match(jobRoute, /WORKFLOW_VIDEO_TOO_SHORT/);
  assert.match(jobRoute, /expectedVideoDurationSeconds/);
  assert.match(jobRoute, /qualityJson: JSON\.stringify\(quality\)/);
  assert.match(segmentRoute, /SEGMENT_VIDEO_INVALID/);
  assert.match(segmentRoute, /SEGMENT_VIDEO_TOO_SHORT/);
  assert.match(segmentRoute, /technical: \{ passed: true/);
  assert.match(episodeRoute, /EPISODE_VIDEO_INVALID/);
  assert.match(episodeRoute, /EPISODE_VIDEO_TOO_SHORT/);
});

test("supports optional AI continuity review and durable creator approval before episode render", async () => {
  const [connections, connectionTest, llm, qualityRoute, mediaClient, mediaWorker, renderRoute, editor, videos, enginePanel, recovery, segmentVersion] = await Promise.all([
    read("../app/api/engine/connections/route.ts"),
    read("../app/api/engine/connections/test/route.ts"),
    read("../app/lib/server/llm.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/quality/route.ts"),
    read("../app/lib/server/media-worker.ts"),
    read("../apps/media-worker/src/main.mjs"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../app/features/settings/EngineConnectionsPanel.tsx"),
    read("../app/lib/server/media-job-recovery.ts"),
    read("../app/lib/segment-version.ts"),
  ]);
  assert.match(connections, /"llm", "vision"/);
  assert.match(connectionTest, /testVisionConnection/);
  assert.match(llm, /reviewSegmentContinuity/);
  assert.match(llm, /image_url/);
  assert.match(llm, /lastTestStatus !== "succeeded"/);
  assert.match(qualityRoute, /structuralReview/);
  assert.match(qualityRoute, /loadEffectiveSegmentReferences/);
  assert.match(qualityRoute, /referencesForShot/);
  assert.match(qualityRoute, /characterFormReferences/);
  assert.match(qualityRoute, /formAssetIds\.length \? formAssetIds/);
  assert.match(qualityRoute, /joined\.segments\.currentVersionNumber/);
  assert.match(qualityRoute, /eq\(segmentVersions\.versionNumber, joined\.segments\.currentVersionNumber\)/);
  assert.match(qualityRoute, /sampleVideoContactSheet/);
  assert.match(qualityRoute, /import \{ waitUntil \} from "cloudflare:workers"/);
  assert.match(qualityRoute, /entityType: "segment_version"/);
  assert.match(qualityRoute, /operation: qualityOperation/);
  assert.match(qualityRoute, /progress: 55/);
  assert.match(qualityRoute, /activeReview/);
  assert.match(qualityRoute, /lastFailure/);
  assert.match(qualityRoute, /status: passed \? "approved" : "review_failed"/);
  assert.match(qualityRoute, /export async function PATCH/);
  assert.match(qualityRoute, /SEGMENT_STRUCTURAL_REVIEW_FAILED/);
  assert.match(qualityRoute, /mode: "creator"/);
  assert.match(qualityRoute, /"manually_approved"/);
  assert.match(recovery, /segment_quality_review/);
  assert.match(recovery, /status: "review_error"/);
  assert.match(mediaClient, /sampleVideoContactSheet/);
  assert.match(mediaWorker, /\/sample-video-frames/);
  assert.match(mediaWorker, /contact-sheet\.jpg/);
  assert.match(renderRoute, /SEGMENT_REVIEW_REQUIRED/);
  assert.match(renderRoute, /segmentVersionApprovedForEpisodeRender/);
  assert.match(segmentVersion, /review\?\.decision === "approved"/);
  assert.match(editor, /片段审片/);
  assert.match(editor, /确认当前版本可用/);
  assert.match(editor, /配置可选 AI 质检/);
  assert.match(editor, /qualityPollTick/);
  assert.match(editor, /视觉质检正在后台执行/);
  assert.match(videos, /待创作者确认/);
  assert.match(videos, /还需确认/);
  assert.match(enginePanel, /文本智能服务/);
  assert.match(enginePanel, /结构化模板 \/ Schema/);
  assert.match(connectionTest, /testVisionConnection/);
});

test("accepts either AI pass or creator approval as episode render evidence", async () => {
  const { segmentVersionApprovedForEpisodeRender } = await import("../app/lib/segment-version.ts");
  assert.equal(segmentVersionApprovedForEpisodeRender(JSON.stringify({ overall: { status: "passed" } }), "ready"), true);
  assert.equal(segmentVersionApprovedForEpisodeRender(JSON.stringify({ review: { decision: "approved" } }), "ready"), true);
  assert.equal(segmentVersionApprovedForEpisodeRender(JSON.stringify({ overall: { status: "manually_approved" } }), "ready"), true);
  assert.equal(segmentVersionApprovedForEpisodeRender(JSON.stringify({ review: { decision: "rejected" } }), "review_failed"), false);
  assert.equal(segmentVersionApprovedForEpisodeRender("{}", "ready"), false);
});

test("exports every current episode version as a durable verified project delivery", async () => {
  const [route, mediaClient, mediaWorker, recovery, videos, smoke, assetsPage, globalAssets] = await Promise.all([
    read("../app/api/projects/[projectId]/export/route.ts"),
    read("../app/lib/server/media-worker.ts"),
    read("../apps/media-worker/src/main.mjs"),
    read("../app/lib/server/media-job-recovery.ts"),
    read("../app/features/videos/VideosPage.tsx"),
    read("../scripts/media-worker-smoke.mjs"),
    read("../app/features/assets/AssetsPage.tsx"),
    read("../app/features/assets/GlobalAssets.tsx"),
  ]);
  assert.match(route, /PROJECT_EPISODES_INCOMPLETE/);
  assert.match(route, /entityType: "project"/);
  assert.match(route, /operation: "project_export"/);
  assert.match(route, /versionSnapshot/);
  assert.match(route, /episodeRenderMatchesCurrentSegments/);
  assert.match(route, /assetType: "project_export"/);
  assert.match(route, /PROJECT_EXPORT_INVALID_ZIP/);
  assert.match(mediaClient, /archiveProjectDelivery/);
  assert.match(mediaClient, /SHA-256/);
  assert.match(mediaClient, /sha256/);
  assert.match(mediaWorker, /\/archive-project/);
  assert.match(mediaWorker, /小飞象交付清单\.json/);
  assert.match(mediaWorker, /zipSync/);
  assert.match(recovery, /"project"/);
  assert.match(videos, /导出整部短剧/);
  assert.match(videos, /交付记录/);
  assert.match(videos, /下载最近交付包/);
  assert.match(smoke, /ARCHIVE_PROJECT_FAILED/);
  assert.match(smoke, /INVALID_ZIP_MANIFEST/);
  assert.match(assetsPage, /assetType === "project_export"/);
  assert.match(assetsPage, /整剧交付包/);
  assert.match(globalAssets, /project_export: "整剧交付包"/);
  assert.match(globalAssets, /kind === "file" \? "ZIP"/);
});

test("invalidates stale episode renders when a segment candidate becomes current", async () => {
  const [stateSource, resultRoute, composeRoute, soundRoute, selectionRoute, renderRoute, contracts, platformSchema] = await Promise.all([
    read("../app/lib/server/production-state.ts"),
    read("../app/api/generation/jobs/[jobId]/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/generate/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/sound/route.ts"),
    read("../app/api/projects/[projectId]/segments/[segmentId]/versions/[versionId]/route.ts"),
    read("../app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts"),
    read("../packages/contracts/src/index.ts"),
    read("../packages/database/src/schema.ts"),
  ]);
  assert.match(stateSource, /videoAssetId: null/);
  assert.match(stateSource, /subtitleAssetId: null/);
  assert.match(stateSource, /deriveProjectRenderStatus/);
  for (const route of [resultRoute, composeRoute, soundRoute, selectionRoute]) assert.match(route, /setCurrentSegmentVersion/);
  assert.match(renderRoute, /markEpisodeRenderStarted/);
  assert.match(renderRoute, /refreshProjectRenderStatus/);
  assert.match(renderRoute, /markEpisodeRenderFailed/);
  for (const status of ["asset_extraction", "asset_review", "production", "rendered", "delivered"]) {
    assert.match(contracts, new RegExp(`"${status}"`));
    assert.match(platformSchema, new RegExp(`"${status}"`));
  }
});

test("derives render readiness only from current segment selections", async () => {
  const delivery = await import("../app/lib/project-delivery.ts");
  assert.equal(delivery.episodeRenderMatchesCurrentSegments(["segment-a", "segment-b"], JSON.stringify({ segmentAssetIds: ["segment-a", "segment-b"] })), true);
  assert.equal(delivery.episodeRenderMatchesCurrentSegments(["segment-a", "segment-new"], JSON.stringify({ segmentAssetIds: ["segment-a", "segment-b"] })), false);
  assert.equal(delivery.episodeRenderMatchesCurrentSegments(["segment-a", null], JSON.stringify({ segmentAssetIds: ["segment-a", "segment-b"] })), false);
  assert.equal(delivery.episodeRenderMatchesCurrentSegments([], JSON.stringify({ segmentAssetIds: [] })), false);
  assert.equal(delivery.deriveProjectRenderStatus([{ status: "rendered", videoAssetId: "ep-1" }, { status: "rendered", videoAssetId: "ep-2" }]), "rendered");
  assert.equal(delivery.deriveProjectRenderStatus([{ status: "rendered", videoAssetId: "ep-1" }, { status: "production", videoAssetId: null }]), "production");
  assert.equal(delivery.deriveProjectRenderStatus([{ status: "rendered", videoAssetId: "ep-1" }, { status: "rendering", videoAssetId: null }]), "rendering");
});

test("restores the authenticated platform account and never uses a fixed profile identity", async () => {
  const [studio, login, shell, editor, canvas, requestUser] = await Promise.all([
    read("../app/features/studio/StudioApp.tsx"),
    read("../app/features/auth/Login.tsx"),
    read("../app/components/layout/StudioShell.tsx"),
    read("../app/features/editor/EditorPage.tsx"),
    read("../app/features/canvas/CanvasWorkspace.tsx"),
    read("../app/lib/server/request-user.ts"),
  ]);
  assert.match(studio, /fetch\("\/api\/me"/);
  assert.match(studio, /ACCOUNT_SESSION_EXPIRED/);
  assert.match(studio, /StudioAuthProvider/);
  assert.match(studio, /signout-with-chatgpt/);
  assert.match(login, /onEnter\(data\.user\)/);
  assert.doesNotMatch(login, /sessionStorage\.setItem/);
  assert.match(shell, /user\.displayName/);
  assert.match(shell, /退出登录/);
  assert.doesNotMatch(shell, />创作者<|profile-avatar">Z/);
  assert.match(editor, /useStudioAuth/);
  assert.match(canvas, /useStudioAuth/);
  assert.doesNotMatch(editor, /profile-avatar">Z/);
  assert.doesNotMatch(canvas, /<i>Z<|profile-avatar">Z/);
  assert.doesNotMatch(login, /profile-avatar">Z/);
  assert.match(requestUser, /oai-authenticated-user-email/);
  assert.match(requestUser, /eq\(users\.email, identity\.email\)/);
});

test("keeps capability test inputs aligned with each menu item", async () => {
  const { workflowCapabilities } = await import("../app/lib/workflow-capabilities.ts");
  const byKey = Object.fromEntries(workflowCapabilities.map((item) => [item.key, item]));
  const inputKeys = (key) => byKey[key].inputs.map((input) => input.key);

  assert.deepEqual(inputKeys("image_generation"), ["prompt", "aspectRatio", "stylePreset"]);
  assert.deepEqual(inputKeys("single_reference_image"), ["prompt", "referenceImage", "aspectRatio"]);
  assert.deepEqual(inputKeys("multi_reference_image"), ["prompt", "referenceImages", "aspectRatio"]);
  assert.equal(byKey.multi_reference_image.inputs.find((input) => input.key === "referenceImages")?.valueType, "imageList");
  assert.equal(byKey.storyboard_frame.inputs.find((input) => input.key === "characterImages")?.valueType, "imageList");
  assert.deepEqual(inputKeys("text_to_video"), ["prompt", "duration", "aspectRatio"]);
  assert.deepEqual(inputKeys("image_to_video"), ["firstFrame", "prompt", "duration", "promptEnhance"]);
  assert.deepEqual(inputKeys("first_last_frame_video"), ["firstFrame", "lastFrame", "prompt", "duration"]);
  assert.deepEqual(inputKeys("image_audio_video"), ["firstFrame", "audio", "prompt", "duration"]);
  assert.deepEqual(inputKeys("reference_video_character"), ["video", "referenceImage", "audio"]);
  assert.deepEqual(inputKeys("voice_synthesis"), ["text", "voiceReference", "voiceDescription"]);
  assert.deepEqual(inputKeys("emotional_voice"), ["text", "emotion", "voiceReference"]);
  assert.deepEqual(inputKeys("voice_clone"), ["voiceReference", "text"]);
  assert.deepEqual(inputKeys("matting_image"), ["referenceImage"]);
  assert.ok(inputKeys("storyboard_frame").includes("characterImages"));
  assert.ok(inputKeys("storyboard_frame").includes("sceneImage"));
});

test("distributes imageList payloads across available LoadImage nodes", async () => {
  const { applyWorkflowInputs, assertWorkflowInputsApplied } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "10": { class_type: "LoadImage", inputs: { image: "placeholder-a.png" } },
    "11": { class_type: "LoadImage", inputs: { image: "placeholder-b.png" } },
    "20": { class_type: "CLIPTextEncode", inputs: { text: "hello" } },
  };
  const contract = {
    referenceImages: { nodeId: "10", input: "image" },
    prompt: { nodeId: "20", input: "text" },
  };
  const payload = {
    referenceImages: ["ref-a.png", "ref-b.png"],
    prompt: "站在一起",
  };
  const prepared = applyWorkflowInputs(workflow, contract, payload);
  assert.equal(prepared["10"].inputs.image, "ref-a.png");
  assert.equal(prepared["11"].inputs.image, "ref-b.png");
  assert.equal(prepared["20"].inputs.text, "站在一起");
  assertWorkflowInputsApplied(prepared, contract, payload);
});

test("asserts imageList slots while respecting other mapped LoadImage nodes", async () => {
  const { applyWorkflowInputs, assertWorkflowInputsApplied } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "78": { class_type: "LoadImage", inputs: { image: "scene.png" }, _meta: { title: "场景参考 sceneImage" } },
    "469": { class_type: "LoadImage", inputs: { image: "char-1.png" }, _meta: { title: "角色参考1 characterImages" } },
    "470": { class_type: "LoadImage", inputs: { image: "char-2.png" }, _meta: { title: "角色参考2 characterImages" } },
  };
  const contract = {
    sceneImage: { nodeId: "78", input: "image" },
    characterImages: { nodeId: "469", input: "image" },
  };
  const payload = {
    sceneImage: "upload-scene.png",
    characterImages: ["upload-char-a.png", "upload-char-b.png"],
  };
  const prepared = applyWorkflowInputs(workflow, contract, payload);
  assertWorkflowInputsApplied(prepared, contract, payload);
  assert.equal(prepared["78"].inputs.image, "upload-scene.png");
  assert.equal(prepared["469"].inputs.image, "upload-char-a.png");
  assert.equal(prepared["470"].inputs.image, "upload-char-b.png");
});

test("scrubs missing optional LoadImage defaults when other refs exist", async () => {
  const { applyWorkflowInputs, assertWorkflowInputsApplied, scrubMappedMediaPlaceholders } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "78": { class_type: "LoadImage", inputs: { image: "baked-scene-demo.png" }, _meta: { title: "场景参考 sceneImage" } },
    "469": { class_type: "LoadImage", inputs: { image: "char-1.png" }, _meta: { title: "角色参考1 characterImages" } },
    "470": { class_type: "LoadImage", inputs: { image: "char-2.png" }, _meta: { title: "角色参考2 characterImages" } },
    "471": { class_type: "LoadImage", inputs: { image: "baked-prop-demo.png" }, _meta: { title: "道具参考 propImages" } },
  };
  const contract = {
    sceneImage: { nodeId: "78", input: "image" },
    characterImages: { nodeId: "469", input: "image" },
  };
  const payload = {
    characterImages: ["upload-a.png"],
    characterImageAssetIds: ["b24fe590-007a-4695-82df-f4cf52e199f3"],
  };
  const scrubbed = scrubMappedMediaPlaceholders(workflow, contract, payload);
  assert.equal(scrubbed["78"].inputs.image, "upload-a.png");
  assert.equal(scrubbed["469"].inputs.image, "char-1.png");
  assert.equal(scrubbed["470"].inputs.image, "char-2.png");
  assert.equal(scrubbed["471"].inputs.image, "baked-prop-demo.png");
  const prepared = applyWorkflowInputs(scrubbed, contract, payload);
  assertWorkflowInputsApplied(prepared, contract, payload);
  assert.equal(prepared["469"].inputs.image, "upload-a.png");
  assert.equal(prepared["470"].inputs.image, "upload-a.png");
  // Extra unoccupied LoadImage in the same pool must not keep baked demo art.
  assert.equal(prepared["471"].inputs.image, "upload-a.png");
});

test("fills mapped lastFrame from firstFrame instead of asset UUID leftovers", async () => {
  const { scrubMappedMediaPlaceholders } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "29": { class_type: "LoadImage", inputs: { image: "baked-first.png" } },
    "39": { class_type: "LoadImage", inputs: { image: "baked-last-missing-on-disk.png" } },
  };
  const contract = {
    firstFrame: { nodeId: "29", input: "image" },
    lastFrame: { nodeId: "39", input: "image" },
  };
  const payload = {
    firstFrame: "xiaofeixiang-shot-first.png",
    firstFrameAssetId: "71db0057-183d-4fc0-a23c-41c4062ee1a4",
    characterImageAssetIds: ["b24fe590-007a-4695-82df-f4cf52e199f3"],
  };
  const scrubbed = scrubMappedMediaPlaceholders(workflow, contract, payload);
  assert.equal(scrubbed["39"].inputs.image, "xiaofeixiang-shot-first.png");
  assert.match(await read("../app/lib/server/generation-submit.ts"), /payload\.lastFrame = payload\.firstFrame/);
});

test("rejects collage multi-character bindings for ordinary storyboard frames", async () => {
  const workflowRouting = await read("../app/lib/workflow-routing.ts");
  assert.match(workflowRouting, /scoreWorkflowBindingForPayload/);
  assert.match(workflowRouting, /Never fall back to prompt-only/);
  assert.match(workflowRouting, /return -100/);
  assert.match(workflowRouting, /characterImages\) score \+= 40/);
  assert.match(await read("../app/lib/server/segment-prompt.ts"), /buildStoryboardFramePrompt/);
  assert.match(await read("../app/lib/server/segment-prompt.ts"), /参考图只用于锁定人物面部身份/);
  assert.match(await read("../app/api/generation/jobs/route.ts"), /\.\.\.referencePayload/);
  assert.doesNotMatch(await read("../app/api/generation/jobs/route.ts"), /Strip image refs/);
});

test("generation reference payload prefers tray primary over character form pack", async () => {
  const source = await read("../app/lib/server/segment-references.ts");
  assert.match(source, /One primary portrait per character/);
  assert.match(source, /reference\.assetId\) return \[reference\.assetId\]/);
  assert.match(source, /item\.isPrimary/);
  assert.doesNotMatch(source, /return referencePack\.length \? referencePack/);
});

test("scrubs baked LoadImage placeholders before applying uploaded first frames", async () => {
  const { applyWorkflowInputs, assertWorkflowInputsApplied, scrubMappedMediaPlaceholders } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "269": { class_type: "LoadImage", inputs: { image: "shot_08.png" } },
    "320:319": { class_type: "PrimitiveStringMultiline", inputs: { value: "old prompt" } },
  };
  const contract = {
    firstFrame: { nodeId: "269", input: "image" },
    prompt: { nodeId: "320:319", input: "value" },
  };
  const payload = {
    firstFrame: "xiaofeixiang-test-upload.png",
    prompt: "开心的蹦跳",
  };
  const scrubbed = scrubMappedMediaPlaceholders(workflow, contract, payload);
  assert.equal(scrubbed["269"].inputs.image, "shot_08.png");
  const prepared = applyWorkflowInputs(scrubbed, contract, payload);
  assertWorkflowInputsApplied(prepared, contract, payload);
  assert.equal(prepared["269"].inputs.image, "xiaofeixiang-test-upload.png");
  assert.equal(prepared["320:319"].inputs.value, "开心的蹦跳");
});

test("routes character concept through text-to-image and pack through consistency after lock", async () => {
  const {
    characterFormConceptBlocker,
    characterFormPackBlocker,
    resolveCharacterConceptCapability,
    resolveCharacterPackCapability,
    buildFormVisualPrompt,
  } = await import("../app/lib/character-visual-generation.ts");
  assert.equal(resolveCharacterConceptCapability(), "image_generation");
  assert.equal(resolveCharacterPackCapability(true), "character_image");
  assert.equal(resolveCharacterPackCapability(false), null);
  assert.match(characterFormConceptBlocker(false) ?? "", /概念图/);
  assert.equal(characterFormConceptBlocker(true), null);
  assert.match(characterFormPackBlocker({ hasConceptAsset: true, conceptLocked: false }) ?? "", /锁定/);
  assert.equal(characterFormPackBlocker({ hasConceptAsset: true, conceptLocked: true }), null);
  assert.match(buildFormVisualPrompt({ characterName: "沈渊", characterDescription: "青云弟子", formName: "觉醒状态", formDescription: "金纹扩散" }), /觉醒状态/);
});

test("scrubs optional mapped LoadImage when reference image is omitted", async () => {
  const { ensureOptionalReferenceImage, scrubMappedMediaPlaceholders } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "12": { class_type: "LoadImage", inputs: { image: "baked-ninja.png" } },
    "99": { class_type: "PrimitiveStringMultiline", inputs: { value: "old prompt" } },
  };
  const contract = {
    prompt: { nodeId: "99", input: "value" },
    referenceImage: { nodeId: "12", input: "image" },
  };
  const payload = { prompt: "穿越者，粗布衫" };
  await ensureOptionalReferenceImage(payload, contract, async () => ({ workflowValue: "xiaofeixiang-empty-reference.png" }), "test");
  assert.equal(payload.referenceImage, "xiaofeixiang-empty-reference.png");
  const scrubbed = scrubMappedMediaPlaceholders(workflow, contract, payload);
  assert.equal(scrubbed["12"].inputs.image, "baked-ninja.png");
});

test("character_image output collection ignores preview and LoadImage nodes", async () => {
  const { selectAllWorkflowImageOutputs } = await import("../app/lib/workflow-output-select.ts");
  const workflow = {
    "10": { class_type: "LoadImage", inputs: { image: "baked-ninja.png" } },
    "20": { class_type: "PreviewImage", inputs: {} },
    "30": { class_type: "SaveImage", inputs: {} },
  };
  const history = {
    outputs: {
      "10": { images: [{ filename: "baked-ninja.png", type: "input" }] },
      "20": { images: [{ filename: "preview.png", type: "output" }] },
      "30": { images: [{ filename: "generated.png", type: "output" }] },
    },
  };
  const files = selectAllWorkflowImageOutputs(history, workflow);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.filename, "generated.png");
  assert.equal(files[0]?.nodeId, "30");
});

test("verifies numeric and boolean workflow inputs were applied", async () => {
  const { applyWorkflowInputs, assertWorkflowInputsApplied } = await import("../app/lib/workflow-input-apply.ts");
  const workflow = {
    "320:301": { class_type: "PrimitiveInt", inputs: { value: 5 } },
    "320:328": { class_type: "PrimitiveBoolean", inputs: { value: false } },
  };
  const contract = {
    duration: { nodeId: "320:301", input: "value" },
    promptEnhance: { nodeId: "320:328", input: "value" },
  };
  const payload = { duration: 3, promptEnhance: true };
  const prepared = applyWorkflowInputs(workflow, contract, payload);
  assertWorkflowInputsApplied(prepared, contract, payload);
  assert.equal(prepared["320:301"].inputs.value, 3);
  assert.equal(prepared["320:328"].inputs.value, true);
});

test("enables LTX text-to-video mode without first-frame constraints", async () => {
  const { buildLtxTextToVideoPrompt, prepareLtxWorkflowExecution } = await import("../app/lib/ltx-video-prompt.ts");
  const workflow = {
    "320:302": { class_type: "PrimitiveBoolean", inputs: { value: false }, _meta: { title: "Switch to Text to Video?" } },
    "320:312": { class_type: "PrimitiveInt", inputs: { value: 720 } },
    "320:299": { class_type: "PrimitiveInt", inputs: { value: 1280 } },
    "320:328": { class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Boolean (Enable Prompt Enhance)" } },
    "320:288": { class_type: "LTXVImgToVideoInplace", inputs: { bypass: ["320:302", 0] } },
  };
  const wrapped = buildLtxTextToVideoPrompt("沙尘暴里的废弃公路");
  assert.match(wrapped, /沙尘暴里的废弃公路/);
  const { workflow: preparedWorkflow, payload } = prepareLtxWorkflowExecution(workflow, { prompt: "沙尘暴里的废弃公路", aspectRatio: "16:9" }, "text_to_video");
  assert.equal(preparedWorkflow["320:302"].inputs.value, true);
  assert.equal(preparedWorkflow["320:312"].inputs.value, 1280);
  assert.equal(preparedWorkflow["320:299"].inputs.value, 720);
  assert.equal(preparedWorkflow["320:328"].inputs.value, false);
  assert.match(String(payload.prompt), /Cinematic short drama shot/i);
});

test("wraps LTX image-to-video prompts and disables Gemma prompt enhance", async () => {
  const { buildLtxImageToVideoPrompt, prepareLtxWorkflowExecution } = await import("../app/lib/ltx-video-prompt.ts");
  const workflow = {
    "269": { class_type: "LoadImage", inputs: { image: "shot_08.png" } },
    "320:325": { class_type: "TextGenerateLTX2Prompt", inputs: { prompt: ["320:319", 0] } },
    "320:328": { class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Boolean (Enable Prompt Enhance)" } },
  };
  const wrapped = buildLtxImageToVideoPrompt("开心招手");
  assert.match(wrapped, /Keep the first frame composition/i);
  assert.match(wrapped, /开心招手/);
  const { workflow: preparedWorkflow, payload } = prepareLtxWorkflowExecution(workflow, { prompt: "开心招手", promptEnhance: true });
  assert.equal(payload.promptEnhance, false);
  assert.equal(preparedWorkflow["320:328"].inputs.value, false);
  assert.match(String(payload.prompt), /Keep the first frame composition/i);
});

test("wraps LTX audio-video prompts and clears baked defaults", async () => {
  const { buildLtxAudioVideoPrompt, prepareLtxWorkflowExecution } = await import("../app/lib/ltx-video-prompt.ts");
  const workflow = {
    "269": { class_type: "LoadImage", inputs: { image: "pos户外首图.png" } },
    "276": { class_type: "LoadAudio", inputs: { audio: "04.wav" } },
    "340:319": { class_type: "PrimitiveStringMultiline", inputs: { value: "A young East Asian man walks slowly" } },
    "340:349": { class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Boolean (Enable Prompt Enhance)" } },
    "340:328": { class_type: "LTXVAudioVAEEncode", inputs: { audio: ["276", 0] } },
  };
  const wrapped = buildLtxAudioVideoPrompt("");
  assert.match(wrapped, /provided audio/i);
  const { workflow: preparedWorkflow, payload } = prepareLtxWorkflowExecution(workflow, {
    firstFrame: "粘土小人.png",
    audio: "01.wav",
    prompt: "",
  });
  assert.equal(preparedWorkflow["340:349"].inputs.value, false);
  assert.match(String(payload.prompt), /provided first frame image/i);
  assert.doesNotMatch(String(payload.prompt), /East Asian man/);
});

test("prepares ChatterBox voice synthesis with optional reference audio", async () => {
  const { buildVoiceSynthesisText, prepareVoiceSynthesisExecution } = await import("../app/lib/server/voice-synthesis-prompt.ts");
  const workflow = {
    "1": { class_type: "LoadAudio", inputs: { audio: "voice_reference.wav" } },
    "2": { class_type: "FL_ChatterboxMultilingualTTS", inputs: { text: "你好", language: "Chinese (zh)", audio_prompt: ["1", 0] } },
    "3": { class_type: "SaveAudio", inputs: { audio: ["2", 0], filename_prefix: "voice" } },
  };
  const contract = {
    text: { nodeId: "2", input: "text" },
    voiceReference: { nodeId: "1", input: "audio" },
  };
  const withoutReference = prepareVoiceSynthesisExecution(workflow, contract, { text: "你好" });
  assert.equal(withoutReference["1"], undefined);
  assert.equal(withoutReference["2"].inputs.audio_prompt, undefined);
  const withReference = prepareVoiceSynthesisExecution(workflow, contract, { text: "你好", voiceReference: "ref.wav" });
  assert.deepEqual(withReference["2"].inputs.audio_prompt, ["1", 0]);
  assert.equal(buildVoiceSynthesisText({ text: "台词", emotion: "愤怒" }), "（愤怒）台词");
  assert.equal(buildVoiceSynthesisText({ text: "台词", emotion: "自然" }), "台词");
});
