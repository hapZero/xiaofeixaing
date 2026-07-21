import { Global, Module } from "@nestjs/common";
import { createDatabase } from "@xiaofeixiang/database";
import { createGenerationQueue } from "@xiaofeixiang/queue";
import { readApiEnvironment } from "./config/environment.js";
import { PlatformLifecycle } from "./platform.lifecycle.js";
import { DATABASE, GENERATION_QUEUE } from "./platform.tokens.js";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: () => createDatabase(readApiEnvironment().databaseUrl),
    },
    {
      provide: GENERATION_QUEUE,
      useFactory: () => createGenerationQueue(readApiEnvironment().redisUrl),
    },
    PlatformLifecycle,
  ],
  exports: [DATABASE, GENERATION_QUEUE],
})
export class PlatformModule {}
