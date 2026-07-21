import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";

export type RequestUser = { id: string; email: string; displayName: string };

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

function decodeName(request: Request): string | null {
  const value = request.headers.get(NAME_HEADER);
  if (!value || request.headers.get(NAME_ENCODING_HEADER) !== "percent-encoded-utf-8") return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

function identityFromRequest(request: Request): { email: string; displayName: string } | null {
  const email = request.headers.get(EMAIL_HEADER)?.trim().toLowerCase();
  if (email) return { email, displayName: decodeName(request) ?? email.split("@")[0] };

  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return { email: "creator@xiaofeixiang.local", displayName: "小飞象创作者" };
  }
  return null;
}

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const identity = identityFromRequest(request);
  if (!identity) return null;
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  if (existing[0]) {
    if (existing[0].displayName !== identity.displayName) {
      await db.update(users).set({ displayName: identity.displayName, updatedAt: new Date() }).where(eq(users.id, existing[0].id));
    }
    return { id: existing[0].id, email: identity.email, displayName: identity.displayName };
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(users).values({ id, email: identity.email, displayName: identity.displayName, createdAt: now, updatedAt: now }).onConflictDoNothing();
  const created = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  return created[0] ? { id: created[0].id, email: created[0].email, displayName: created[0].displayName } : null;
}
