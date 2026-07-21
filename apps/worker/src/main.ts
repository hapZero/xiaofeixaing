import { randomUUID } from "node:crypto";
import { ComfyUiClient } from "@xiaofeixiang/comfyui-client";
import type { CreateGenerationJobCommand } from "@xiaofeixiang/contracts";
import { createRedisConnection, GENERATION_QUEUE } from "@xiaofeixiang/queue";
import { Worker } from "bullmq";
import { readWorkerEnvironment } from "./environment.js";
import { PayloadWorkflowResolver } from "./workflow-resolver.js";

const environment = readWorkerEnvironment();
const connection = createRedisConnection(environment.redisUrl);
const comfyUi = new ComfyUiClient({
  baseUrl: environment.comfyUiUrl,
  apiKey: environment.comfyUiApiKey,
  clientId: `xiaofeixiang-worker-${randomUUID()}`,
});
const workflows = new PayloadWorkflowResolver();

const worker = new Worker<CreateGenerationJobCommand>(
  GENERATION_QUEUE,
  async (job) => {
    await job.updateProgress(5);
    const workflow = await workflows.resolve(job.data);
    await job.updateProgress(15);
    const promptId = await comfyUi.queue(workflow);
    await job.updateProgress(25);
    return { promptId, capability: job.data.capability, queuedAt: new Date().toISOString() };
  },
  { connection, concurrency: environment.concurrency },
);

worker.on("completed", (job) => console.info("generation.completed", { jobId: job.id }));
worker.on("failed", (job, error) => console.error("generation.failed", { jobId: job?.id, error: error.message }));

async function shutdown(signal: string) {
  console.info("worker.shutdown", { signal });
  await worker.close();
  await connection.quit();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
