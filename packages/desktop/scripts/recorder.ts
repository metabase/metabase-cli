import { execFile, spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { DriverFailure } from "./app";

const execFileAsync = promisify(execFile);

const DISPLAY_ENV_VAR = "DISPLAY";
const VIDEO_SIZE = "1440x900";
const FRAME_RATE = "15";
export const MAX_CLIP_SECONDS = 60;
const STOP_TIMEOUT_MS = 15_000;
const SECOND_MS = 1000;

function requireDisplay(): string {
  const display = process.env[DISPLAY_ENV_VAR];
  if (display === undefined || display.length === 0) {
    throw new DriverFailure(
      `${DISPLAY_ENV_VAR} is not set; run this under xvfb-run so ffmpeg has a screen to grab`,
    );
  }
  return display;
}

function startRecorder(display: string, path: string): ChildProcess {
  return spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-video_size",
      VIDEO_SIZE,
      "-framerate",
      FRAME_RATE,
      "-i",
      display,
      "-t",
      String(MAX_CLIP_SECONDS),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      path,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
}

// ffmpeg writes the container's index on a clean shutdown, so the recording is stopped by asking
// it to quit rather than by killing it, and a clip that never closes is a failed run.
async function stopRecorder(recorder: ChildProcess, closed: Promise<void>): Promise<void> {
  const stopped = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      recorder.kill("SIGINT");
      reject(new DriverFailure(`ffmpeg did not stop within ${String(STOP_TIMEOUT_MS)} ms`));
    }, STOP_TIMEOUT_MS);
    void closed.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  recorder.stdin?.write("q");
  recorder.stdin?.end();
  await stopped;
}

async function clipSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new DriverFailure(`ffprobe read no duration from ${path}: ${stdout}`);
  }
  return seconds;
}

// x11grab hands ffmpeg fewer frames than it asks for on a busy Xvfb and then stamps the ones it
// got at the rate it asked for, so the raw capture plays back fast. The clip is re-timed against
// the wall clock the run took, which is the length a reviewer is promised.
async function retime(raw: string, path: string, wallSeconds: number): Promise<void> {
  const captured = await clipSeconds(raw);
  const ratio = wallSeconds / captured;
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    raw,
    "-filter:v",
    `setpts=${ratio.toFixed(4)}*PTS`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path,
  ]);
  await rm(raw, { force: true });
}

export interface RecordedClip {
  readonly path: string;
  readonly seconds: number;
}

export interface Clip {
  readonly stop: () => Promise<RecordedClip>;
}

// Records the Xvfb screen into `<dir>/<name>.mp4` until `stop`, or for a minute at most.
export function startClip(dir: string, name: string): Clip {
  const path = join(dir, `${name}.mp4`);
  const raw = join(dir, `${name}.raw.mp4`);
  const recorder = startRecorder(requireDisplay(), raw);
  const closed = new Promise<void>((resolve) => {
    recorder.on("close", () => {
      resolve();
    });
  });
  const startedAt = Date.now();
  return {
    stop: async () => {
      const wallSeconds = (Date.now() - startedAt) / SECOND_MS;
      if (recorder.exitCode === null) {
        await stopRecorder(recorder, closed);
      }
      await retime(raw, path, Math.min(wallSeconds, MAX_CLIP_SECONDS));
      return { path, seconds: await clipSeconds(path) };
    },
  };
}
