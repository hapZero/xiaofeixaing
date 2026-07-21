import { integerInRange, optionalString, requiredString } from "@xiaofeixiang/config";

export interface WorkerEnvironment {
  redisUrl: string;
  comfyUiUrl: string;
  comfyUiApiKey?: string;
  concurrency: number;
}

export function readWorkerEnvironment(): WorkerEnvironment {
  return {
    redisUrl: requiredString(process.env, "REDIS_URL"),
    comfyUiUrl: requiredString(process.env, "COMFYUI_URL"),
    comfyUiApiKey: optionalString(process.env, "COMFYUI_API_KEY"),
    concurrency: integerInRange(process.env, "WORKER_CONCURRENCY", 2, 1, 32),
  };
}
