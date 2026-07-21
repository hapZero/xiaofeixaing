export interface ComfyUiClientConfig { baseUrl: string; apiKey?: string; clientId: string; timeoutMs?: number }

export class ComfyUiClient {
  constructor(private readonly config: ComfyUiClientConfig) {}

  private headers(): HeadersInit {
    return this.config.apiKey ? { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` } : { "content-type": "application/json" };
  }

  async queue(workflow: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/prompt`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ prompt: workflow, client_id: this.config.clientId }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
    });
    if (!response.ok) throw new Error(`COMFYUI_QUEUE_FAILED:${response.status}`);
    const data = await response.json() as { prompt_id?: string };
    if (!data.prompt_id) throw new Error("COMFYUI_PROMPT_ID_MISSING");
    return data.prompt_id;
  }

  async history(promptId: string): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`, { headers: this.headers(), signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000) });
    if (!response.ok) throw new Error(`COMFYUI_HISTORY_FAILED:${response.status}`);
    return response.json();
  }
}
