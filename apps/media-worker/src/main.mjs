import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { strToU8, zipSync } from "fflate";

const port = Number(process.env.MEDIA_WORKER_PORT || 8091);
const token = process.env.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker";
const ffmpeg = process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";

function replyJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    process.stderr.on("data", (chunk) => { errorOutput = `${errorOutput}${chunk}`.slice(-12_000); });
    process.once("error", reject);
    process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFMPEG_FAILED:${code}:${errorOutput}`)));
  });
}

async function webRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value) headers.set(name, value);
  }
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request),
    duplex: "half",
  });
}

async function mixAudio(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 256 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const manifest = JSON.parse(String(form.get("manifest") || "{}"));
  const durationMs = Math.max(100, Math.min(60 * 60 * 1_000, Number(manifest.durationMs) || 0));
  const tracks = Array.isArray(manifest.tracks) ? manifest.tracks.slice(0, 200) : [];
  if (!durationMs || !tracks.length) return replyJson(response, 400, { error: "AUDIO_TRACKS_REQUIRED" });

  const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-media-"));
  try {
    const inputPaths = [];
    for (let index = 0; index < tracks.length; index += 1) {
      const file = form.get(`track_${index}`);
      if (!(file instanceof File)) throw new Error(`TRACK_FILE_MISSING:${index}`);
      const path = join(directory, `track-${index}`);
      await writeFile(path, new Uint8Array(await file.arrayBuffer()));
      inputPaths.push(path);
    }
    const outputPath = join(directory, "mixed.wav");
    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    for (const [index, path] of inputPaths.entries()) {
      if (tracks[index]?.loop === true) args.push("-stream_loop", "-1");
      args.push("-i", path);
    }
    const filters = tracks.map((track, index) => {
      const delay = Math.max(0, Math.round(Number(track.startMs) || 0));
      const gain = Math.max(-60, Math.min(20, Number(track.gainDb) || 0));
      const requestedDurationMs = Math.max(0, Math.min(durationMs, Number(track.durationMs) || 0));
      const trim = track.loop === true && requestedDurationMs > 0 ? `,atrim=duration=${requestedDurationMs / 1_000}` : "";
      return `[${index}:a]aresample=48000${trim},adelay=${delay}|${delay},volume=${gain}dB[a${index}]`;
    });
    const inputs = tracks.map((_, index) => `[a${index}]`).join("");
    filters.push(`${inputs}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=${durationMs / 1_000}[mixed]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[mixed]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outputPath);
    await run(ffmpeg, args);
    const bytes = await readFile(outputPath);
    response.writeHead(200, { "content-type": "audio/wav", "content-length": String(bytes.byteLength), "x-media-duration-ms": String(durationMs) });
    response.end(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function muxVideoAudio(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 1024 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const video = form.get("video");
  const audio = form.get("audio");
  if (!(video instanceof File) || !(audio instanceof File)) return replyJson(response, 400, { error: "VIDEO_AND_AUDIO_REQUIRED" });
  const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-media-"));
  try {
    const videoPath = join(directory, "source-video");
    const audioPath = join(directory, "source-audio");
    const outputPath = join(directory, "muxed.mp4");
    await Promise.all([
      writeFile(videoPath, new Uint8Array(await video.arrayBuffer())),
      writeFile(audioPath, new Uint8Array(await audio.arrayBuffer())),
    ]);
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outputPath]);
    const bytes = await readFile(outputPath);
    response.writeHead(200, { "content-type": "video/mp4", "content-length": String(bytes.byteLength) });
    response.end(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function composeVideos(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 4 * 1024 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const manifest = JSON.parse(String(form.get("manifest") || "{}"));
  const count = Math.max(0, Math.min(500, Number(manifest.count) || 0));
  const width = Math.max(256, Math.min(3840, Number(manifest.width) || 1280));
  const height = Math.max(256, Math.min(3840, Number(manifest.height) || 720));
  if (!count) return replyJson(response, 400, { error: "VIDEO_SEGMENTS_REQUIRED" });
  const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-episode-"));
  try {
    const normalizedPaths = [];
    const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`;
    for (let index = 0; index < count; index += 1) {
      const file = form.get(`video_${index}`);
      if (!(file instanceof File)) throw new Error(`VIDEO_FILE_MISSING:${index}`);
      const inputPath = join(directory, `source-${index}`);
      const outputPath = join(directory, `normalized-${index}.mp4`);
      await writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
      const common = ["-vf", videoFilter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
      try {
        await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a:0", ...common, outputPath]);
      } catch {
        await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-shortest", ...common, outputPath]);
      }
      normalizedPaths.push(outputPath);
    }
    const concatPath = join(directory, "segments.txt");
    await writeFile(concatPath, normalizedPaths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
    const outputPath = join(directory, "episode.mp4");
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
    const bytes = await readFile(outputPath);
    response.writeHead(200, { "content-type": "video/mp4", "content-length": String(bytes.byteLength) });
    response.end(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function burnSubtitles(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 4 * 1024 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const video = form.get("video");
  const subtitles = form.get("subtitles");
  const manifest = JSON.parse(String(form.get("manifest") || "{}"));
  if (!(video instanceof File) || !(subtitles instanceof File)) return replyJson(response, 400, { error: "VIDEO_AND_SUBTITLES_REQUIRED" });
  const styleKey = ["short_drama", "cinematic", "minimal"].includes(manifest.style) ? manifest.style : "short_drama";
  const styles = {
    short_drama: "FontName=Noto Sans CJK SC,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=54",
    cinematic: "FontName=Noto Sans CJK SC,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00202020,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=38",
    minimal: "FontName=Noto Sans CJK SC,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00404040,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=30",
  };
  const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-subtitles-"));
  try {
    const videoPath = join(directory, "source.mp4");
    const subtitlePath = join(directory, "subtitles.srt");
    const outputPath = join(directory, "subtitled.mp4");
    await Promise.all([
      writeFile(videoPath, new Uint8Array(await video.arrayBuffer())),
      writeFile(subtitlePath, new Uint8Array(await subtitles.arrayBuffer())),
    ]);
    const escapedSubtitlePath = subtitlePath.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
    const filter = `subtitles='${escapedSubtitlePath}':charenc=UTF-8:force_style='${styles[styleKey]}'`;
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", filter, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outputPath]);
    const bytes = await readFile(outputPath);
    response.writeHead(200, { "content-type": "video/mp4", "content-length": String(bytes.byteLength), "x-subtitle-style": styleKey });
    response.end(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function sampleVideoFrames(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 4 * 1024 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const video = form.get("video");
  const manifest = JSON.parse(String(form.get("manifest") || "{}"));
  if (!(video instanceof File)) return replyJson(response, 400, { error: "VIDEO_REQUIRED" });
  const durationMs = Math.max(500, Math.min(60 * 60 * 1_000, Number(manifest.durationMs) || 5_000));
  const count = Math.max(4, Math.min(9, Number(manifest.count) || 6));
  const columns = count <= 6 ? 3 : 3;
  const rows = Math.ceil(count / columns);
  const fps = count / (durationMs / 1_000);
  const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-contact-sheet-"));
  try {
    const inputPath = join(directory, "source.mp4");
    const outputPath = join(directory, "contact-sheet.jpg");
    await writeFile(inputPath, new Uint8Array(await video.arrayBuffer()));
    const filter = `fps=${fps.toFixed(4)},scale=480:-2:force_original_aspect_ratio=decrease,tile=${columns}x${rows}:nb_frames=${count}:padding=4:margin=4:color=black`;
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vf", filter, "-frames:v", "1", "-q:v", "3", outputPath]);
    const bytes = await readFile(outputPath);
    response.writeHead(200, { "content-type": "image/jpeg", "content-length": String(bytes.byteLength), "x-frame-count": String(count) });
    response.end(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function safeArchivePath(value, fallback) {
  const normalized = String(value || fallback)
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 160))
    .join("/");
  return normalized || fallback;
}

async function archiveProject(request, response) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > 8 * 1024 * 1024 * 1024) return replyJson(response, 413, { error: "PAYLOAD_TOO_LARGE" });
  const form = await (await webRequest(request)).formData();
  const manifest = JSON.parse(String(form.get("manifest") || "{}"));
  const entries = Array.isArray(manifest.entries) ? manifest.entries.slice(0, 2_000) : [];
  if (!entries.length || !manifest.delivery) return replyJson(response, 400, { error: "ARCHIVE_ENTRIES_REQUIRED" });

  const archive = Object.create(null);
  archive["小飞象交付清单.json"] = strToU8(`${JSON.stringify(manifest.delivery, null, 2)}\n`);
  for (let index = 0; index < entries.length; index += 1) {
    const file = form.get(`file_${index}`);
    if (!(file instanceof File)) throw new Error(`ARCHIVE_FILE_MISSING:${index}`);
    let name = safeArchivePath(entries[index]?.name, `files/file-${index}`);
    if (archive[name]) name = safeArchivePath(`${name}-${index}`, `files/file-${index}`);
    archive[name] = new Uint8Array(await file.arrayBuffer());
  }
  const bytes = zipSync(archive, { level: 0 });
  response.writeHead(200, {
    "content-type": "application/zip",
    "content-length": String(bytes.byteLength),
    "x-archive-entry-count": String(entries.length + 1),
  });
  response.end(bytes);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return replyJson(response, 200, { ok: true, ffmpeg: true });
    if (request.headers.authorization !== `Bearer ${token}`) return replyJson(response, 401, { error: "UNAUTHORIZED" });
    if (request.method === "POST" && request.url === "/mix-audio") return await mixAudio(request, response);
    if (request.method === "POST" && request.url === "/mux-video-audio") return await muxVideoAudio(request, response);
    if (request.method === "POST" && request.url === "/compose-videos") return await composeVideos(request, response);
    if (request.method === "POST" && request.url === "/burn-subtitles") return await burnSubtitles(request, response);
    if (request.method === "POST" && request.url === "/sample-video-frames") return await sampleVideoFrames(request, response);
    if (request.method === "POST" && request.url === "/archive-project") return await archiveProject(request, response);
    return replyJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MEDIA_WORKER_FAILED";
    console.error("media-worker.request.failed", { url: request.url, message });
    return replyJson(response, 500, { error: "MEDIA_WORKER_FAILED", message });
  }
});

server.listen(port, "127.0.0.1", () => console.info(`xiaofeixiang media worker listening on http://127.0.0.1:${port}`));
