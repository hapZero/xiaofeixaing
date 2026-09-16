import { asc, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { generationJobs, users } from "../../../db/schema";
import { GET as syncGenerationJobRoute } from "../../api/generation/jobs/[jobId]/route";

type RunnerUser = { id: string; email: string; displayName: string };

function internalRequest(user: RunnerUser, jobId: string) {
  return new Request(`https://internal.xiaofeixiang.local/api/generation/jobs/${jobId}`, { headers: {
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.displayName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  } });
}

async function syncJob(user: RunnerUser, jobId: string) {
  const response = await syncGenerationJobRoute(internalRequest(user, jobId), { params: Promise.resolve({ jobId }) });
  const body = await response.json() as { job?: { status?: string; errorCode?: string | null; errorMessage?: string | null }; error?: { code?: string; message?: string } };
  return {
    jobId,
    status: body.job?.status ?? "sync_failed",
    errorCode: body.job?.errorCode ?? body.error?.code ?? null,
    errorMessage: body.job?.errorMessage ?? body.error?.message ?? null,
  };
}

/**
 * Reconciles every durable generation job independently of the page that
 * submitted it. This is what lets creators leave the asset/editor page while
 * ComfyUI continues and still have the output archived into the project.
 */
export async function runActiveGenerationJobs(limit = 8) {
  const db = getDb();
  const activeStatuses = ["submitting", "queued", "running"];
  const jobs = await db.select().from(generationJobs)
    .where(inArray(generationJobs.status, activeStatuses))
    .orderBy(asc(generationJobs.updatedAt))
    .limit(Math.max(1, Math.min(32, limit)));
  if (!jobs.length) return { active: 0, results: [] };

  const ownerIds = [...new Set(jobs.map((job) => job.ownerId))];
  const owners = await db.select().from(users).where(inArray(users.id, ownerIds));
  const results = [];
  for (const job of jobs) {
    const owner = owners.find((candidate) => candidate.id === job.ownerId);
    if (!owner) {
      results.push({ jobId: job.id, status: "sync_failed", errorCode: "JOB_OWNER_MISSING", errorMessage: "生成任务所属账号不存在" });
      continue;
    }
    try {
      results.push(await syncJob(owner, job.id));
    } catch (error) {
      results.push({ jobId: job.id, status: "sync_failed", errorCode: "JOB_RECONCILE_FAILED", errorMessage: error instanceof Error ? error.message : "生成任务同步失败" });
    }
  }
  const remaining = await db.select({ id: generationJobs.id }).from(generationJobs)
    .where(inArray(generationJobs.status, activeStatuses))
    .limit(1);
  return { active: remaining.length, results };
}
