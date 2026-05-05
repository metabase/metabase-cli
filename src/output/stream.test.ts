import { Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pipeToStdout } from "./stream";

interface Capture {
  bytes: Buffer[];
  fake: Writable;
  original: NodeJS.WriteStream;
}

let capture: Capture;

beforeEach(() => {
  const bytes: Buffer[] = [];
  const fake = new Writable({
    write(chunk, _encoding, callback) {
      bytes.push(Buffer.from(chunk));
      callback();
    },
  });
  capture = { bytes, fake, original: process.stdout };
  Object.defineProperty(process, "stdout", { value: fake, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "stdout", { value: capture.original, configurable: true });
});

function readableFrom(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const remaining = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = remaining.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
  });
}

function captured(): string {
  return Buffer.concat(capture.bytes).toString("utf8");
}

describe("pipeToStdout", () => {
  it("forwards a single chunk to process.stdout", async () => {
    await pipeToStdout(readableFrom(["hello world"]));
    expect(captured()).toBe("hello world");
  });

  it("preserves chunk order and concatenation", async () => {
    await pipeToStdout(readableFrom(["one", "-", "two", "-", "three"]));
    expect(captured()).toBe("one-two-three");
  });

  it("resolves with no output when the stream is empty", async () => {
    await pipeToStdout(readableFrom([]));
    expect(captured()).toBe("");
  });

  it("propagates a stream error instead of silently completing", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("source blew up"));
      },
    });
    const error = await pipeToStdout(failing).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected Error");
    }
    expect(error.message).toBe("source blew up");
  });
});
