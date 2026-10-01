import { PassThrough } from "node:stream";

import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { AbortError, ConfigError } from "@metabase/client/errors";

const hoisted = vi.hoisted(() => ({
  text: vi.fn<(opts: unknown) => Promise<unknown>>(),
  password: vi.fn<(opts: unknown) => Promise<unknown>>(),
  confirm: vi.fn<(opts: unknown) => Promise<unknown>>(),
  select: vi.fn<(opts: unknown) => Promise<unknown>>(),
  cancelSymbol: Symbol("clack:cancel"),
}));

vi.mock("@clack/prompts", () => ({
  text: (opts: unknown) => hoisted.text(opts),
  password: (opts: unknown) => hoisted.password(opts),
  confirm: (opts: unknown) => hoisted.confirm(opts),
  select: (opts: unknown) => hoisted.select(opts),
  isCancel: (value: unknown) => value === hoisted.cancelSymbol,
}));

const { promptConfirm, promptLine, promptPassword, promptSelect, promptText } =
  await import("./prompt");

const originalStdin = process.stdin;
const originalStderr = process.stderr;

function setIsTTY(value: boolean): void {
  Object.defineProperty(process, "stdin", {
    value: { isTTY: value },
    configurable: true,
    writable: true,
  });
}

function restoreStdin(): void {
  Object.defineProperty(process, "stdin", {
    value: originalStdin,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(process, "stderr", {
    value: originalStderr,
    configurable: true,
    writable: true,
  });
}

interface FakeTerminal {
  input: PassThrough;
  output: () => string;
}

// A TTY-flagged stdin the test types into, and a stderr that records what the prompt printed.
function fakeTerminal(): FakeTerminal {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  const errors = new PassThrough();
  const chunks: string[] = [];
  errors.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  Object.defineProperty(process, "stdin", { value: input, configurable: true, writable: true });
  Object.defineProperty(process, "stderr", { value: errors, configurable: true, writable: true });
  return { input, output: () => chunks.join("") };
}

beforeEach(() => {
  setIsTTY(true);
  hoisted.text.mockReset();
  hoisted.password.mockReset();
  hoisted.confirm.mockReset();
  hoisted.select.mockReset();
});

afterEach(() => {
  restoreStdin();
});

describe("promptText", () => {
  it("throws ConfigError when stdin is not a TTY (clack would otherwise hang)", async () => {
    setIsTTY(false);
    const error = await promptText({ message: "Name" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe('cannot prompt "Name" — stdin is not a TTY');
    expect(hoisted.text).not.toHaveBeenCalled();
  });

  it("converts clack's cancel symbol into AbortError", async () => {
    hoisted.text.mockResolvedValueOnce(hoisted.cancelSymbol);
    const error = await promptText({ message: "Name" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
  });

  it("omits undefined optional fields from the clack call (exactOptionalPropertyTypes)", async () => {
    hoisted.text.mockResolvedValueOnce("x");
    await promptText({ message: "URL", initialValue: "https://m" });
    expect(hoisted.text).toHaveBeenCalledWith({
      message: "URL",
      defaultValue: "",
      initialValue: "https://m",
    });
  });

  it("forwards defaultValue so an empty submit resolves to it rather than undefined", async () => {
    hoisted.text.mockResolvedValueOnce("default");
    const value = await promptText({ message: "Profile name", defaultValue: "default" });
    expect(hoisted.text).toHaveBeenCalledWith({
      message: "Profile name",
      defaultValue: "default",
    });
    expect(value).toBe("default");
  });
});

describe("promptPassword", () => {
  it("converts clack's cancel symbol into AbortError", async () => {
    hoisted.password.mockResolvedValueOnce(hoisted.cancelSymbol);
    const error = await promptPassword({ message: "API key" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
  });
});

describe("promptConfirm", () => {
  it("converts clack's cancel symbol into AbortError", async () => {
    hoisted.confirm.mockResolvedValueOnce(hoisted.cancelSymbol);
    const error = await promptConfirm({ message: "Continue?" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
  });
});

describe("promptSelect", () => {
  it("converts clack's cancel symbol into AbortError", async () => {
    hoisted.select.mockResolvedValueOnce(hoisted.cancelSymbol);
    const error = await promptSelect<"red">({
      message: "Color",
      choices: [{ value: "red", label: "Red" }],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
  });
});

function acceptCode(value: string): string | null {
  return value.startsWith("code") ? null : "expected a code";
}

describe("promptLine", () => {
  it("throws ConfigError when stdin is not a TTY", async () => {
    setIsTTY(false);
    const error = await promptLine({
      message: "Paste",
      validate: acceptCode,
      signal: new AbortController().signal,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe('cannot prompt "Paste" — stdin is not a TTY');
  });

  it("re-asks with the validator's reason until an answer is accepted", async () => {
    const terminal = fakeTerminal();
    const answer = promptLine({
      message: "Paste",
      validate: acceptCode,
      signal: new AbortController().signal,
    });
    terminal.input.write("garbage\r");
    await vi.waitFor(() => expect(terminal.output()).toContain("expected a code\n"));
    terminal.input.write("code-123\r");
    expect(await answer).toBe("code-123");
  });

  it("rejects with AbortError once the caller withdraws it", async () => {
    fakeTerminal();
    const withdraw = new AbortController();
    const answer = promptLine({ message: "Paste", validate: acceptCode, signal: withdraw.signal });
    withdraw.abort();
    const error = await answer.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
    assert(error instanceof AbortError, "expected AbortError");
    expect(error.message).toBe("aborted");
  });

  it("rejects with AbortError on Ctrl-C", async () => {
    const terminal = fakeTerminal();
    const answer = promptLine({
      message: "Paste",
      validate: acceptCode,
      signal: new AbortController().signal,
    });
    terminal.input.write("\x03");
    const error = await answer.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
    assert(error instanceof AbortError, "expected AbortError");
    expect(error.message).toBe("aborted");
  });

  it("rejects with AbortError when the input ends", async () => {
    const terminal = fakeTerminal();
    const answer = promptLine({
      message: "Paste",
      validate: acceptCode,
      signal: new AbortController().signal,
    });
    terminal.input.end();
    const error = await answer.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AbortError);
    assert(error instanceof AbortError, "expected AbortError");
    expect(error.message).toBe("aborted");
  });
});
