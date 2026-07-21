import { integerInRange, requiredString } from "@xiaofeixiang/config";

export interface ApiEnvironment {
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

export function readApiEnvironment(): ApiEnvironment {
  return {
    port: integerInRange(process.env, "API_PORT", 4000, 1, 65_535),
    databaseUrl: requiredString(process.env, "DATABASE_URL"),
    redisUrl: requiredString(process.env, "REDIS_URL"),
  };
}
