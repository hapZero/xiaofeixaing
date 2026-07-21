import { and, eq } from "drizzle-orm";
import { getDb, getMediaBucket } from "../../../../../db";
import { assets, episodes, generationJobs, shots, workflowBindings } from "../../../../../db/schema";
import { downloadWorkflowOutput, getHistoryRecord, getWorkflowHistory, historyFailed, selectWorkflowOutput, type WorkflowOutputContract } from "../../../../lib/server/comfyui";
import { errorResponse, json } from "../../../../lib/server/http";
import { getRequestUser } from "../../../../lib/server/request-user";
import { syncExecutionProgress } from "../../../../lib/server/workflow-progress";

type RouteContext = { params: Promise<{ jobId: string }> };

function extension(filename: string, mediaType: WorkflowOutputContract["mediaType"]) {
  const candidate = filename.match(/\.[a-z0-9]{2,6}$/i)?.[0];
  return candidate ?? ({ image: ".png", video: ".mp4", audio: ".wav", json: ".json" } as const)[mediaType];
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return errorResponse(401, "AUTH_REQUIRED", "请先登录小飞象");
  const { jobId } = await context.params;
  const db = getDb();
  const rows = await db.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.ownerId, user.id))).limit(1);
  const job = rows[0];
  if (!job) return errorResponse(404, "JOB_NOT_FOUND", "生成任务不存在");
  if (!job.comfyPromptId || !["queued", "running"].includes(job.status)) return json({ job });

  try {
    const live = await syncExecutionProgress({ ownerId: user.id, executionType: "generation_job", executionId: jobId, promptId: job.comfyPromptId });
    if (live?.snapshot.status === "failed") throw new Error("COMFYUI_EXECUTION_FAILED");
    const history = await getWorkflowHistory(job.comfyPromptId);
    const record = getHistoryRecord(history, job.comfyPromptId);
    if (!record) {
      if (job.status !== "running") await db.update(generationJobs).set({ status: "running", updatedAt: new Date() }).where(eq(generationJobs.id, jobId));
      return json({ job: { ...job, status: "running", progress: live?.progress ?? null } });
    }
    if (historyFailed(record)) {
      const failed = { status: "failed", errorCode: "COMFYUI_EXECUTION_FAILED", errorMessage: "ComfyUI 工作流执行失败", finishedAt: new Date(), updatedAt: new Date() };
      await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
      return json({ job: { ...job, ...failed } });
    }
    if (!job.workflowBindingId) throw new Error("WORKFLOW_BINDING_MISSING");
    const binding = (await db.select().from(workflowBindings).where(and(eq(workflowBindings.id, job.workflowBindingId), eq(workflowBindings.ownerId, user.id))).limit(1))[0];
    if (!binding) throw new Error("WORKFLOW_BINDING_MISSING");
    const outputContract = JSON.parse(binding.outputContractJson) as WorkflowOutputContract;
    const output = selectWorkflowOutput(record, outputContract);
    if (!output) throw new Error(`WORKFLOW_OUTPUT_MISSING:${outputContract.nodeId}.${outputContract.output}`);
    if (output.outputKey && output.outputKey !== outputContract.output) {
      await db.update(workflowBindings).set({ outputContractJson: JSON.stringify({ ...outputContract, output: output.outputKey }), updatedAt: new Date() }).where(eq(workflowBindings.id, binding.id));
    }
    const downloaded = await downloadWorkflowOutput(output);
    const assetId = crypto.randomUUID();
    const storageKey = `generated/${user.id}/${job.projectId}/${assetId}${extension(output.filename, outputContract.mediaType)}`;
    await getMediaBucket().put(storageKey, downloaded.bytes, { httpMetadata: { contentType: downloaded.contentType } });

    let episodeId: string | null = null;
    if (job.entityType === "shot") {
      const shot = (await db.select().from(shots).where(eq(shots.id, job.entityId)).limit(1))[0];
      if (shot) {
        const episode = (await db.select().from(episodes).where(eq(episodes.id, shot.episodeId)).limit(1))[0];
        if (episode?.projectId === job.projectId) episodeId = episode.id;
      }
    }
    const now = new Date();
    const assetType = `${job.capability}_${outputContract.mediaType}`;
    await db.insert(assets).values({
      id: assetId,
      projectId: job.projectId,
      episodeId,
      assetType,
      name: output.filename,
      status: "ready",
      storageKey,
      thumbnailUrl: `/api/assets/${assetId}/content`,
      metadataJson: JSON.stringify({ jobId, promptId: job.comfyPromptId, mediaType: outputContract.mediaType, source: output }),
      createdAt: now,
      updatedAt: now,
    });
    if (job.entityType === "shot" && job.capability === "storyboard_frame") {
      await db.update(shots).set({ firstFrameAssetId: assetId, status: "frame_ready", updatedAt: now }).where(eq(shots.id, job.entityId));
    }
    if (job.entityType === "shot" && ["image_to_video", "lip_sync", "native_audio_video"].includes(job.capability)) {
      await db.update(shots).set({ videoAssetId: assetId, status: "video_ready", updatedAt: now }).where(eq(shots.id, job.entityId));
    }
    const result = { assetId, assetUrl: `/api/assets/${assetId}/content`, mediaType: outputContract.mediaType, filename: output.filename };
    const completed = { status: "succeeded", resultJson: JSON.stringify(result), finishedAt: now, updatedAt: now };
    await db.update(generationJobs).set(completed).where(eq(generationJobs.id, jobId));
    return json({ job: { ...job, ...completed, result, progress: { ...(live?.progress ?? {}), overall: 100, stage: "生成结果已归档" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HISTORY_UNAVAILABLE";
    const failed = { status: "failed", errorCode: message.split(":")[0], errorMessage: message, finishedAt: new Date(), updatedAt: new Date() };
    await db.update(generationJobs).set(failed).where(eq(generationJobs.id, jobId));
    return json({ job: { ...job, ...failed } });
  }
}
