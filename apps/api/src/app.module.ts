import { Module } from "@nestjs/common";
import { GenerationController } from "./generation/generation.controller.js";
import { GenerationService } from "./generation/generation.service.js";
import { HealthController } from "./health/health.controller.js";
import { PlatformModule } from "./platform.module.js";

@Module({
  imports: [PlatformModule],
  controllers: [HealthController, GenerationController],
  providers: [GenerationService],
})
export class AppModule {}
