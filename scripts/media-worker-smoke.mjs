import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`COMMAND_FAILED:${code}:${stderr.slice(-2_000)}`)));
  });
}

const directory = await mkdtemp(join(tmpdir(), "xiaofeixiang-smoke-"));
try {
  const videoPath = join(directory, "input.mp4");
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x28334a:s=360x640:d=2:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath,
  ]);
  const ambiencePath = join(directory, "ambience.wav");
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=0.4",
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", ambiencePath,
  ]);
  const mixBody = new FormData();
  mixBody.set("manifest", JSON.stringify({ durationMs: 2_000, tracks: [{ startMs: 0, gainDb: -6, loop: true, durationMs: 2_000 }] }));
  mixBody.set("track_0", new File([await readFile(ambiencePath)], "ambience.wav", { type: "audio/wav" }));
  const mixResponse = await fetch(`${process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8091"}/mix-audio`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker"}` },
    body: mixBody,
  });
  if (!mixResponse.ok) throw new Error(`MIX_AUDIO_FAILED:${mixResponse.status}:${await mixResponse.text()}`);
  const mixedAudio = new Uint8Array(await mixResponse.arrayBuffer());
  const audibleTailBytes = mixedAudio.slice(-20_000).filter((byte) => byte !== 0).length;
  if (mixResponse.headers.get("x-media-duration-ms") !== "2000" || mixedAudio.byteLength < 300_000 || audibleTailBytes < 1_000) {
    throw new Error(`INVALID_LOOPED_MIX:${mixedAudio.byteLength}:${audibleTailBytes}`);
  }
  const body = new FormData();
  body.set("manifest", JSON.stringify({ style: "short_drama" }));
  const sourceVideo = await readFile(videoPath);
  body.set("video", new File([sourceVideo], "input.mp4", { type: "video/mp4" }));
  body.set("subtitles", new File([new TextEncoder().encode("1\n00:00:00,200 --> 00:00:01,800\n小飞象字幕烧录测试\n")], "test.srt", { type: "application/x-subrip; charset=utf-8" }));
  const response = await fetch(`${process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8091"}/burn-subtitles`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker"}` },
    body,
  });
  if (!response.ok) throw new Error(`BURN_SUBTITLES_FAILED:${response.status}:${await response.text()}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 32));
  if (bytes.byteLength < 2_000 || !header.includes("ftyp")) throw new Error(`INVALID_MP4:${bytes.byteLength}`);
  const sampleBody = new FormData();
  sampleBody.set("manifest", JSON.stringify({ durationMs: 2_000, count: 6 }));
  sampleBody.set("video", new File([sourceVideo], "input.mp4", { type: "video/mp4" }));
  const sampleResponse = await fetch(`${process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8091"}/sample-video-frames`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker"}` },
    body: sampleBody,
  });
  if (!sampleResponse.ok) throw new Error(`SAMPLE_VIDEO_FAILED:${sampleResponse.status}:${await sampleResponse.text()}`);
  const contactSheet = new Uint8Array(await sampleResponse.arrayBuffer());
  if (contactSheet.byteLength < 2_000 || contactSheet[0] !== 0xff || contactSheet[1] !== 0xd8) throw new Error(`INVALID_CONTACT_SHEET:${contactSheet.byteLength}`);
  const archiveBody = new FormData();
  archiveBody.set("manifest", JSON.stringify({
    delivery: { format: "xiaofeixiang-project-delivery/v1", project: { id: "smoke", title: "媒体测试" }, episodes: [{ episodeNumber: 1, versionNumber: 1 }] },
    entries: [{ name: "成片/第01集-v1.mp4" }, { name: "字幕/第01集-v1.srt" }],
  }));
  archiveBody.set("file_0", new File([sourceVideo], "episode.mp4", { type: "video/mp4" }));
  archiveBody.set("file_1", new File([new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\n测试\n")], "episode.srt", { type: "application/x-subrip" }));
  const archiveResponse = await fetch(`${process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8091"}/archive-project`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MEDIA_WORKER_TOKEN || "xiaofeixiang-local-media-worker"}` },
    body: archiveBody,
  });
  if (!archiveResponse.ok) throw new Error(`ARCHIVE_PROJECT_FAILED:${archiveResponse.status}:${await archiveResponse.text()}`);
  const archive = new Uint8Array(await archiveResponse.arrayBuffer());
  if (archive.byteLength <= sourceVideo.byteLength || archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error(`INVALID_ZIP:${archive.byteLength}`);
  const archiveText = new TextDecoder().decode(archive);
  if (!archiveText.includes("xiaofeixiang-project-delivery/v1") || !archiveText.includes("第01集-v1.mp4")) throw new Error("INVALID_ZIP_MANIFEST");
  console.info(JSON.stringify({ ok: true, mixedAudioBytes: mixedAudio.byteLength, audibleTailBytes, subtitledBytes: bytes.byteLength, contactSheetBytes: contactSheet.byteLength, archiveBytes: archive.byteLength, archiveEntries: archiveResponse.headers.get("x-archive-entry-count"), sampledFrames: sampleResponse.headers.get("x-frame-count"), style: response.headers.get("x-subtitle-style") }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
