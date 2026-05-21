import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbortError, ConfigError } from "../core/errors";

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

const { promptConfirm, promptPassword, promptSelect, promptText } = await import("./prompt");

const originalStdin = process.stdin;

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
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
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
