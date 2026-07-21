import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { projects } from "../../../db/schema";

export async function getOwnedProject(projectId: string, ownerId: string) {
  const result = await getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).limit(1);
  return result[0] ?? null;
}
