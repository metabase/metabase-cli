import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, ValidationError } from "../core/errors";
import { readBody } from "./body";

interface MockStdin {
  isTTY: boolean;
  [Symbol.asyncIterator]: () => AsyncIterator<string>;
}

const originalStdin = process.stdin;

function setStdin(replacement: MockStdin | NodeJS.ReadStream): void {
  Object.defineProperty(process, "stdin", {
    value: replacement,
    configurable: true,
    writable: true,
  });
}

function tty(): MockStdin {
  return {
    isTTY: true,
    [Symbol.asyncIterator]() {
      return Readable.from([])[Symbol.asyncIterator]();
    },
  };
}

function piped(content: string): MockStdin {
  return {
    isTTY: false,
    [Symbol.asyncIterator]() {
      return Readable.from([content])[Symbol.asyncIterator]();
    },
  };
}

const Card = z.object({ id: z.number(), name: z.string() });

describe("readBody", () => {
  let tempDir: string;
  let filePath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mb-body-"));
    filePath = join(tempDir, "card.json");
    writeFileSync(filePath, '{"id":7,"name":"from-file"}', "utf8");
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    setStdin(tty());
  });

  afterEach(() => {
    setStdin(originalStdin);
  });

  it("parses JSON from --body flag", async () => {
    const result = await readBody({ flag: '{"id":1,"name":"x"}' }, Card);
    expect(result).toEqual({ id: 1, name: "x" });
  });

  it("parses JSON from --file path", async () => {
    const result = await readBody({ file: filePath }, Card);
    expect(result).toEqual({ id: 7, name: "from-file" });
  });

  it("parses JSON from stdin when piped", async () => {
    setStdin(piped('{"id":2,"name":"piped"}'));
    const result = await readBody({}, Card);
    expect(result).toEqual({ id: 2, name: "piped" });
  });

  it("parses JSON from positional argument", async () => {
    const result = await readBody({ positional: '{"id":3,"name":"pos"}' }, Card);
    expect(result).toEqual({ id: 3, name: "pos" });
  });

  it("rejects multiple explicit body sources", async () => {
    const error = await readBody({ flag: '{"id":1,"name":"a"}', file: filePath }, Card).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("multiple body sources given (--body, --file); pass exactly one");
  });

  it("rejects all three explicit sources at once", async () => {
    const error = await readBody(
      {
        flag: '{"id":1,"name":"a"}',
        file: filePath,
        positional: '{"id":2,"name":"b"}',
      },
      Card,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "multiple body sources given (--body, --file, positional); pass exactly one",
    );
  });

  it("throws ConfigError when no source provided and stdin is a TTY", async () => {
    const error = await readBody({}, Card).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
  });

  it("throws ValidationError when JSON does not match the schema", async () => {
    const error = await readBody({ flag: '{"id":"bad","name":"x"}', source: "--body" }, Card).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    assert(error instanceof ValidationError, "expected ValidationError");
    expect(error.message).toContain("--body");
  });

  it("throws ConfigError when JSON is malformed", async () => {
    const error = await readBody({ flag: "{ not json }" }, Card).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("invalid JSON: ");
  });

  it("uses caller-provided source label in error messages", async () => {
    const error = await readBody(
      { flag: '{"id":"bad","name":"x"}', source: "card create body" },
      Card,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    assert(error instanceof ValidationError, "expected ValidationError");
    expect(error.message).toContain("card create body");
  });
});
