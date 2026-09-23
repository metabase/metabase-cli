import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { startProcess, type RunningProcess } from "./spawn";

const ECHO_STDIN = "process.stdin.on('data', (chunk) => process.stdout.write(chunk));";

const NEVER_EXITS = "setInterval(() => {}, 1000);";

function start(source: string, command: string = process.execPath): RunningProcess {
  const started = startProcess({
    command,
    args: ["-e", source],
    env: process.env,
    cwd: tmpdir(),
  });
  if (started.kind === "start-failed") {
    throw new Error(started.message);
  }
  return started;
}

function firstChunk(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve) => {
    stream.once("data", (chunk: Buffer) => {
      resolve(chunk.toString("utf8"));
    });
  });
}

describe("startProcess", () => {
  it("carries stdin through to stdout", async () => {
    const running = start(ECHO_STDIN);
    running.stdin.write("ping\n");
    expect(await firstChunk(running.stdout)).toBe("ping\n");
    await running.stop();
  });

  it("reports a binary it could not reach through the exit it never had", async () => {
    const running = start(NEVER_EXITS, "/nonexistent/rde-not-a-binary");
    expect(await running.exited).toEqual({
      kind: "failed",
      message: "spawn /nonexistent/rde-not-a-binary ENOENT",
    });
  });

  it("stops a process that would otherwise never exit", async () => {
    const running = start(NEVER_EXITS);
    const exit = await running.stop();
    expect(exit).toEqual({ kind: "exited", code: null, signal: "SIGTERM" });
  });

  it("answers with the exit it already had when stopped twice", async () => {
    const running = start(NEVER_EXITS);
    await running.stop();
    expect(await running.stop()).toEqual({ kind: "exited", code: null, signal: "SIGTERM" });
  });
});
