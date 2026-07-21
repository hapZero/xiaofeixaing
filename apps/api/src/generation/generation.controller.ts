import { Body, Controller, Inject, Post, ValidationPipe } from "@nestjs/common";
import { CreateGenerationJobDto } from "./dto/create-generation-job.dto.js";
import { GenerationService } from "./generation.service.js";

@Controller("generation-jobs")
export class GenerationController {
  constructor(@Inject(GenerationService) private readonly generation: GenerationService) {}

  @Post()
  create(
    @Body(new ValidationPipe({
      expectedType: CreateGenerationJobDto,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })) command: CreateGenerationJobDto,
  ) {
    return this.generation.enqueue(command);
  }
}
