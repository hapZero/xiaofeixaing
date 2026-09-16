import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { runtimeHeartbeats } from "../../../db/schema";

export type RuntimeHeartbeatStatus = "online" | "degraded";
export type RuntimeHeartbeatDetails = {
  mode?: "continuous" | "scheduled";
  active?: number;
  generationJobs?: Record<string, unknown>;
  episodes?: Record<string, unknown>;
  visualAssets?: Record<string, unknown>;
  message?: string;
};

export async function recordRuntimeHeartbeat(input: {
  service: string;
  instanceId: string;
  status: RuntimeHeartbeatStatus;
  details?: RuntimeHeartbeatDetails;
}) {
  const now = new Date();
  const detailsJson = JSON.stringify(input.details ?? {});
  await getDb().insert(runtimeHeartbeats).values({
    service: input.service,
    instanceId: input.instanceId,
    status: input.status,
    detailsJson,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: runtimeHeartbeats.service,
    set: {
      instanceId: input.instanceId,
      status: input.status,
      detailsJson,
      lastSeenAt: now,
      updatedAt: now,
    },
  });
}

export async function readRuntimeHeartbeat(service: string) {
  const row = (await getDb().select().from(runtimeHeartbeats).where(eq(runtimeHeartbeats.service, service)).limit(1))[0];
  if (!row) return null;
  let details: RuntimeHeartbeatDetails = {};
  try {
    details = JSON.parse(row.detailsJson) as RuntimeHeartbeatDetails;
  } catch {
    details = {};
  }
  const freshnessMs = details.mode === "scheduled" ? 120_000 : 20_000;
  const ageMs = Math.max(0, Date.now() - row.lastSeenAt.getTime());
  return {
    service: row.service,
    instanceId: row.instanceId,
    status: ageMs <= freshnessMs ? row.status as RuntimeHeartbeatStatus : "offline" as const,
    fresh: ageMs <= freshnessMs,
    ageMs,
    lastSeenAt: row.lastSeenAt,
    details,
  };
}
