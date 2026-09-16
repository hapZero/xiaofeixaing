const endpoint = process.env.BATCH_RUNNER_URL || "http://localhost:3000/api/internal/production/tick";
const token = process.env.BATCH_RUNNER_TOKEN || "xiaofeixiang-local-batch-runner";
const instanceId = process.env.BATCH_RUNNER_INSTANCE_ID || `local-${crypto.randomUUID()}`;
let stopping = false;
let lastError = "";

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopping = true; });

while (!stopping) {
  let delay = 5_000;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-runner-instance": instanceId,
        "x-runner-mode": "continuous",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`BATCH_RUNNER_HTTP_${response.status}:${(await response.text()).slice(0, 300)}`);
    const result = await response.json();
    delay = Number(result.active) > 0 ? 1_500 : 5_000;
    lastError = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError && !message.includes("fetch failed")) console.error("batch-runner", message);
    lastError = message;
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}
