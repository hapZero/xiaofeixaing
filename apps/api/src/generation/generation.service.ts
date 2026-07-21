import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CreateGenerationJobCommand } from "@xiaofeixiang/contracts";
import type { GenerationQueue } from "@xiaofeixiang/queue";
import { GENERATION_QUEUE } from "../platform.tokens.js";

@Injectable()
export class GenerationService {
  constructor(@Inject(GENERATION_QUEUE) private readonly queue: GenerationQueue) {}

  async enqueue(command: CreateGenerationJobCommand) {
    const existing = await this.queue.getJob(command.idempotencyKey);
    if (existing) {
      const state = await existing.getState();
      return { jobId: existing.id, state, duplicate: true };
    }

    try {
      const job = await this.queue.add(command.capability, command, { jobId: command.idempotencyKey });
      return { jobId: job.id, state: "waiting", duplicate: false };
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("jobid")) {
        throw new ConflictException("生成任务已存在");
      }
      throw error;
    }
  }
}
