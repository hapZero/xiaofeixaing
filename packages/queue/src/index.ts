import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { CreateGenerationJobCommand, WorkflowCapability } from "@xiaofeixiang/contracts";

export const GENERATION_QUEUE = "xiaofeixiang-generation";

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createGenerationQueue(redisUrl: string) {
  return new Queue<CreateGenerationJobCommand, unknown, WorkflowCapability>(GENERATION_QUEUE, {
    connection: createRedisConnection(redisUrl),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3_000 }, removeOnComplete: 500, removeOnFail: 1_000 },
  });
}

export type GenerationQueue = ReturnType<typeof createGenerationQueue>;
