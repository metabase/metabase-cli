import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";
import { readInput } from "./input";

interface MockStdin {
  isTTY: boolean;
  pause: () => void;
  unref: () => void;
  [Symbol.asyncIterator]: () => AsyncIterator<string>;
}

const noop = (): void => {};

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
    pause: noop,
    unref: noop,
    [Symbol.asyncIterator]() {
      return Readable.from([])[Symbol.asyncIterator]();
    },
  };
}

function piped(content: string): MockStdin {
  return {
    isTTY: false,
    pause: noop,
    unref: noop,
    [Symbol.asyncIterator]() {
      return Readable.from([content])[Symbol.asyncIterator]();
    },
  };
}

function idlePipe(): MockStdin {
  return {
    isTTY: false,
    pause: noop,
    unref: noop,
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise<IteratorResult<string>>(() => {});
        },
      };
    },
  };
}

describe("readInput precedence", () => {
  let tempDir: string;
  let filePath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mb-input-"));
    filePath = join(tempDir, "body.txt");
    writeFileSync(filePath, "from-file", "utf8");
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

  it("returns the flag value when only flag is provided", async () => {
    expect(await readInput({ flag: "from-flag" })).toBe("from-flag");
  });

  it("returns file contents when only file is provided", async () => {
    expect(await readInput({ file: filePath })).toBe("from-file");
  });

  it("auto-detects piped stdin when isTTY is false", async () => {
    setStdin(piped("from-pipe"));
    expect(await readInput({})).toBe("from-pipe");
  });

  it("returns the positional value when only positional is provided", async () => {
    expect(await readInput({ positional: "from-positional" })).toBe("from-positional");
  });

  it("flag wins over file, piped stdin, and positional", async () => {
    setStdin(piped("from-stdin"));
    const result = await readInput({
      flag: "from-flag",
      file: filePath,
      positional: "from-positional",
    });
    expect(result).toBe("from-flag");
  });

  it("file wins over piped stdin and positional", async () => {
    setStdin(piped("from-stdin"));
    const result = await readInput({
      file: filePath,
      positional: "from-positional",
    });
    expect(result).toBe("from-file");
  });

  it("piped stdin wins over positional", async () => {
    setStdin(piped("from-stdin"));
    const result = await readInput({
      positional: "from-positional",
    });
    expect(result).toBe("from-stdin");
  });

  it("falls through to positional when pipe is empty", async () => {
    setStdin(piped(""));
    const result = await readInput({
      positional: "from-positional",
    });
    expect(result).toBe("from-positional");
  });

  it("times out an idle non-TTY stdin instead of hanging, then falls through to positional", async () => {
    setStdin(idlePipe());
    const result = await readInput({ positional: "from-positional" });
    expect(result).toBe("from-positional");
  });

  it("times out an idle non-TTY stdin and throws the required-input error", async () => {
    setStdin(idlePipe());
    const error = await readInput({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "input required: provide one of --body, --file, stdin, or a positional argument",
    );
  });

  it("throws ConfigError listing all sources when required and all empty", async () => {
    const error = await readInput({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "input required: provide one of --body, --file, stdin, or a positional argument",
    );
  });

  it("names the concrete body flag in the required error when flagName is provided", async () => {
    const error = await readInput({ flagName: "--value" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "input required: provide one of --value, --file, stdin, or a positional argument",
    );
  });

  it("returns empty string when not required and all sources are empty", async () => {
    expect(await readInput({ required: false })).toBe("");
  });

  it("throws ConfigError when --file path does not exist", async () => {
    const missing = join(tempDir, "does-not-exist.txt");
    const error = await readInput({ file: missing }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(`--file not found: ${missing}`);
  });

  it("treats --file - as stdin", async () => {
    setStdin(piped("from-stdin-via-dash"));
    expect(await readInput({ file: "-" })).toBe("from-stdin-via-dash");
  });

  it("--file - returns empty string when stdin is empty", async () => {
    setStdin(piped(""));
    expect(await readInput({ file: "-" })).toBe("");
  });
});
