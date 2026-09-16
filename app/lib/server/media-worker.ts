import { env } from "cloudflare:workers";
import { getMediaBucket } from "../../../db";
import type { assets } from "../../../db/schema";

type RuntimeEnv = { MEDIA_WORKER_URL?: string; MEDIA_WORKER_TOKEN?: string };
type StoredAsset = typeof assets.$inferSelect;

function config() {
  const runtime = env as unknown as RuntimeEnv;
  return {
    baseUrl: (runtime.MEDIA_WORKER_URL || "http://127.0.0.1:8091").replace(/\/$/, ""),
    token: runtime.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker",
  };
}

export async function testMediaWorkerConnection(): Promise<{ configured: boolean; connected: boolean; serverUrl: string; message: string }> {
  const worker = config();
  try {
    const response = await fetch(`${worker.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { configured: true, connected: false, serverUrl: worker.baseUrl, message: `媒体处理器响应异常（HTTP ${response.status}）` };
    const body = await response.json() as { ok?: boolean; ffmpeg?: boolean };
    const connected = body.ok === true && body.ffmpeg === true;
    return { configured: true, connected, serverUrl: worker.baseUrl, message: connected ? "FFmpeg 媒体处理器连接正常" : "媒体处理器未报告 FFmpeg 就绪" };
  } catch {
    return { configured: true, connected: false, serverUrl: worker.baseUrl, message: "FFmpeg 媒体处理器未运行" };
  }
}

export async function mixAudioTracks(input: {
  durationMs: number;
  tracks: Array<{ asset: StoredAsset; startMs: number; gainDb: number; loop?: boolean; durationMs?: number }>;
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const body = new FormData();
  body.set("manifest", JSON.stringify({
    durationMs: input.durationMs,
    tracks: input.tracks.map((track) => ({ startMs: track.startMs, gainDb: track.gainDb, loop: track.loop === true, durationMs: track.durationMs })),
  }));
  for (const [index, track] of input.tracks.entries()) {
    if (!track.asset.storageKey) throw new Error(`MEDIA_ASSET_NOT_READY:${track.asset.id}`);
    const object = await getMediaBucket().get(track.asset.storageKey);
    if (!object) throw new Error(`MEDIA_FILE_NOT_FOUND:${track.asset.id}`);
    body.set(`track_${index}`, new File([await object.arrayBuffer()], track.asset.name || `track-${index}`, { type: object.httpMetadata?.contentType || "application/octet-stream" }));
  }
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/mix-audio`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "audio/wav" };
}

export async function muxVideoAndAudio(input: { video: StoredAsset; audio: StoredAsset }): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const body = new FormData();
  for (const [key, asset] of [["video", input.video], ["audio", input.audio]] as const) {
    if (!asset.storageKey) throw new Error(`MEDIA_ASSET_NOT_READY:${asset.id}`);
    const object = await getMediaBucket().get(asset.storageKey);
    if (!object) throw new Error(`MEDIA_FILE_NOT_FOUND:${asset.id}`);
    body.set(key, new File([await object.arrayBuffer()], asset.name || key, { type: object.httpMetadata?.contentType || "application/octet-stream" }));
  }
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/mux-video-audio`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "video/mp4" };
}

export async function composeEpisodeVideos(input: { videos: StoredAsset[]; width: number; height: number }): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!input.videos.length) throw new Error("EPISODE_VIDEOS_REQUIRED");
  const body = new FormData();
  body.set("manifest", JSON.stringify({ count: input.videos.length, width: input.width, height: input.height }));
  for (const [index, asset] of input.videos.entries()) {
    if (!asset.storageKey) throw new Error(`MEDIA_ASSET_NOT_READY:${asset.id}`);
    const object = await getMediaBucket().get(asset.storageKey);
    if (!object) throw new Error(`MEDIA_FILE_NOT_FOUND:${asset.id}`);
    body.set(`video_${index}`, new File([await object.arrayBuffer()], asset.name || `segment-${index}.mp4`, { type: object.httpMetadata?.contentType || "video/mp4" }));
  }
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/compose-videos`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "video/mp4" };
}

export async function burnEpisodeSubtitles(input: {
  videoBytes: ArrayBuffer;
  videoContentType: string;
  subtitles: string;
  style: "short_drama" | "cinematic" | "minimal";
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const body = new FormData();
  body.set("manifest", JSON.stringify({ style: input.style }));
  body.set("video", new File([input.videoBytes], "episode.mp4", { type: input.videoContentType || "video/mp4" }));
  body.set("subtitles", new File([new TextEncoder().encode(input.subtitles)], "episode.srt", { type: "application/x-subrip; charset=utf-8" }));
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/burn-subtitles`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "video/mp4" };
}

export async function sampleVideoContactSheet(input: { video: StoredAsset; durationMs: number; count?: number }): Promise<{ bytes: ArrayBuffer; contentType: string; frameCount: number }> {
  if (!input.video.storageKey) throw new Error(`MEDIA_ASSET_NOT_READY:${input.video.id}`);
  const object = await getMediaBucket().get(input.video.storageKey);
  if (!object) throw new Error(`MEDIA_FILE_NOT_FOUND:${input.video.id}`);
  const body = new FormData();
  body.set("manifest", JSON.stringify({ durationMs: input.durationMs, count: input.count ?? 6 }));
  body.set("video", new File([await object.arrayBuffer()], input.video.name || "segment.mp4", { type: object.httpMetadata?.contentType || "video/mp4" }));
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/sample-video-frames`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "image/jpeg", frameCount: Number(response.headers.get("x-frame-count")) || input.count || 6 };
}

export type ProjectDeliveryEntry = {
  asset: StoredAsset;
  name: string;
  mediaType: "video" | "subtitle";
  episodeId: string;
  episodeNumber: number;
  versionNumber: number;
};

export async function archiveProjectDelivery(input: {
  delivery: Record<string, unknown>;
  entries: ProjectDeliveryEntry[];
}): Promise<{ bytes: ArrayBuffer; contentType: string; entryCount: number; delivery: Record<string, unknown> }> {
  if (!input.entries.length) throw new Error("PROJECT_EXPORT_FILES_REQUIRED");
  const files: Array<ProjectDeliveryEntry & { bytes: ArrayBuffer; contentType: string; size: number; sha256: string }> = [];
  for (const entry of input.entries) {
    if (!entry.asset.storageKey) throw new Error(`MEDIA_ASSET_NOT_READY:${entry.asset.id}`);
    const object = await getMediaBucket().get(entry.asset.storageKey);
    if (!object) throw new Error(`MEDIA_FILE_NOT_FOUND:${entry.asset.id}`);
    const bytes = await object.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    files.push({
      ...entry,
      bytes,
      contentType: object.httpMetadata?.contentType || (entry.mediaType === "video" ? "video/mp4" : "application/x-subrip; charset=utf-8"),
      size: bytes.byteLength,
      sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    });
  }
  const delivery = {
    ...input.delivery,
    files: files.map((entry) => ({
      name: entry.name,
      assetId: entry.asset.id,
      episodeId: entry.episodeId,
      episodeNumber: entry.episodeNumber,
      versionNumber: entry.versionNumber,
      mediaType: entry.mediaType,
      size: entry.size,
      sha256: entry.sha256,
    })),
  };
  const body = new FormData();
  body.set("manifest", JSON.stringify({ delivery, entries: files.map((entry) => ({ name: entry.name })) }));
  files.forEach((entry, index) => body.set(`file_${index}`, new File([entry.bytes], entry.asset.name || `file-${index}`, { type: entry.contentType })));
  const worker = config();
  const response = await fetch(`${worker.baseUrl}/archive-project`, { method: "POST", headers: { authorization: `Bearer ${worker.token}` }, body, signal: AbortSignal.timeout(900_000) });
  if (!response.ok) throw new Error(`MEDIA_WORKER_FAILED:${response.status}:${(await response.text()).slice(0, 1_000)}`);
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "application/zip",
    entryCount: Number(response.headers.get("x-archive-entry-count")) || files.length + 1,
    delivery,
  };
}
