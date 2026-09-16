export type ServiceTestStatus = "untested" | "invalidated" | "succeeded" | "failed";

export type ServiceTestMetadata = {
  lastTestStatus: ServiceTestStatus;
  lastTestedAt: string | null;
  lastTestError: string | null;
};

export function readServiceTestMetadata(value: string | null | undefined): ServiceTestMetadata {
  if (!value) return { lastTestStatus: "untested", lastTestedAt: null, lastTestError: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const status = ["invalidated", "succeeded", "failed"].includes(String(parsed.lastTestStatus))
      ? String(parsed.lastTestStatus) as ServiceTestStatus
      : "untested";
    return {
      lastTestStatus: status,
      lastTestedAt: typeof parsed.lastTestedAt === "string" ? parsed.lastTestedAt : null,
      lastTestError: typeof parsed.lastTestError === "string" ? parsed.lastTestError : null,
    };
  } catch {
    return { lastTestStatus: "untested", lastTestedAt: null, lastTestError: null };
  }
}

export function writeServiceTestMetadata(value: string | null | undefined, metadata: Partial<ServiceTestMetadata>) {
  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  return JSON.stringify({ ...current, ...metadata });
}
