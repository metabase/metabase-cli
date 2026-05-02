import { afterEach, describe, expect, it } from "vitest";

import { AbortError } from "../core/errors";
import { abortReason, createProcessAbortHandler, type ProcessAbortHandler } from "./signal";

describe("createProcessAbortHandler", () => {
  const installed: ProcessAbortHandler[] = [];

  afterEach(() => {
    while (installed.length > 0) {
      const handle = installed.pop();
      handle?.uninstall();
    }
  });

  it("aborts the signal with AbortError when SIGINT fires", () => {
    const handle = createProcessAbortHandler();
    installed.push(handle);

    expect(handle.signal.aborted).toBe(false);
    process.emit("SIGINT");

    expect(handle.signal.aborted).toBe(true);
    const reason: unknown = handle.signal.reason;
    expect(reason).toBeInstanceOf(AbortError);
    if (!(reason instanceof AbortError)) {
      throw new Error("expected AbortError");
    }
    expect(reason.exitCode).toBe(130);
  });

  it("only aborts on the first SIGINT — subsequent SIGINTs reach a fresh handler", () => {
    const first = createProcessAbortHandler();
    installed.push(first);

    process.emit("SIGINT");
    expect(first.signal.aborted).toBe(true);
    const initialReason: unknown = first.signal.reason;

    const second = createProcessAbortHandler();
    installed.push(second);

    process.emit("SIGINT");
    expect(first.signal.reason).toBe(initialReason);
    expect(second.signal.aborted).toBe(true);
  });

  it("uninstall() detaches the SIGINT handler so the signal stays open", () => {
    const handle = createProcessAbortHandler();
    handle.uninstall();

    process.emit("SIGINT");
    expect(handle.signal.aborted).toBe(false);
  });
});

describe("abortReason", () => {
  it("returns an existing MetabaseError reason unchanged", () => {
    const controller = new AbortController();
    const original = new AbortError("interrupted");
    controller.abort(original);

    expect(abortReason(controller.signal)).toBe(original);
  });

  it("wraps a string reason in an AbortError preserving the message", () => {
    const controller = new AbortController();
    controller.abort("custom-reason");

    const wrapped = abortReason(controller.signal);
    expect(wrapped).toBeInstanceOf(AbortError);
    expect(wrapped.message).toBe("custom-reason");
  });

  it("converts a DOMException-style reason to an AbortError keeping its exit code", () => {
    const controller = new AbortController();
    controller.abort();

    const wrapped = abortReason(controller.signal);
    expect(wrapped).toBeInstanceOf(AbortError);
    expect(wrapped.exitCode).toBe(130);
  });
});
