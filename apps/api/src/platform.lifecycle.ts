import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { XiaofeixiangDatabase } from "@xiaofeixiang/database";
import type { GenerationQueue } from "@xiaofeixiang/queue";
import { DATABASE, GENERATION_QUEUE } from "./platform.tokens.js";

@Injectable()
export class PlatformLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly database: XiaofeixiangDatabase,
    @Inject(GENERATION_QUEUE) private readonly queue: GenerationQueue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.queue.close(), this.database.pool.end()]);
  }
}
