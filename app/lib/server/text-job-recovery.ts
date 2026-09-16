import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { episodes, generationJobs, projects } from "../../../db/schema";

const TEXT_JOB_LEASE_MS = 5 * 60 * 1_000;
const TEXT_ANALYSIS_LEASE_MS = 20 * 60 * 1_000;

function textJobLeaseMs(capability: string) {
  return capability === "llm_analysis" ? TEXT_ANALYSIS_LEASE_MS : TEXT_JOB_LEASE_MS;
}

function milliseconds(value: Date | number | string | null) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1_000 : value;
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}

export async function recoverInterruptedTextJobs(ownerId: string, projectId: string) {
  const db = getDb();
  const active = await db.select().from(generationJobs).where(and(
    eq(generationJobs.ownerId, ownerId),
    eq(generationJobs.projectId, projectId),
    inArray(generationJobs.capability, ["llm_script", "llm_structure", "llm_episode", "llm_analysis"]),
    inArray(generationJobs.status, ["queued", "running"]),
  ));
  const interrupted = active.filter((job) => milliseconds(job.updatedAt) <= Date.now() - textJobLeaseMs(job.capability));
  if (!interrupted.length) return 0;

  const failedAt = new Date();
  for (const job of interrupted) {
    await db.update(generationJobs).set({
      status: "failed",
      errorCode: "TEXT_JOB_INTERRUPTED",
      errorMessage: "文本智能任务长时间没有完成，可能因服务重启或连接中断而停止；原始内容已经保留，可安全重试",
      finishedAt: failedAt,
      updatedAt: failedAt,
    }).where(and(eq(generationJobs.id, job.id), inArray(generationJobs.status, ["queued", "running"])));
    if (job.capability === "llm_episode" && job.entityType === "episode") {
      const episode = (await db.select({ scriptText: episodes.scriptText }).from(episodes).where(eq(episodes.id, job.entityId)).limit(1))[0];
      if (episode) await db.update(episodes).set({ status: episode.scriptText ? "editing" : "draft", updatedAt: failedAt }).where(eq(episodes.id, job.entityId));
    }
  }
  const latest = interrupted[0];
  await db.update(projects).set({
    status: latest.capability === "llm_analysis" ? "script_analysis_failed" : latest.capability === "llm_structure" ? "script_structure_failed" : "script_generation_failed",
    updatedAt: failedAt,
  }).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  return interrupted.length;
}
