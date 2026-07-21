import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { readApiEnvironment } from "./config/environment.js";

async function bootstrap() {
  const environment = readApiEnvironment();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(environment.port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error("api.bootstrap_failed", error);
  process.exitCode = 1;
});
