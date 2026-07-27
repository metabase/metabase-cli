import { describe, expect, it } from "vitest";

import { AbortError } from "./errors";
import { abortReason, combineAborts, throwIfAborted } from "./signal";

describe("combineAborts", () => {
  it("aborts as soon as one composed source does, carrying that source's reason", () => {
    const caller = new AbortController();
    const clientWide = new AbortController();
    const combined = combineAborts(caller.signal, clientWide.signal);
    expect(combined.aborted).toBe(false);

    const reason = new AbortError("interrupted");
    clientWide.abort(reason);

    expect(combined.aborted).toBe(true);
    expect(abortReason(combined)).toBe(reason);
  });

  it("skips absent sources instead of composing them", () => {
    const caller = new AbortController();
    const combined = combineAborts(undefined, caller.signal, undefined);

    caller.abort(new AbortError("interrupted"));

    expect(combined.aborted).toBe(true);
  });

  it("returns a signal that never aborts when every source is absent", () => {
    expect(combineAborts(undefined, undefined).aborted).toBe(false);
  });
});

describe("throwIfAborted", () => {
  it("throws the first aborted signal's reason and ignores the live ones", () => {
    const live = new AbortController();
    const aborted = new AbortController();
    const reason = new AbortError("interrupted");
    aborted.abort(reason);

    expect(() => throwIfAborted(live.signal, undefined, aborted.signal)).toThrowError(reason);
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

  it("converts a DOMException-style reason to an AbortError inside the taxonomy", () => {
    const controller = new AbortController();
    controller.abort();

    const wrapped = abortReason(controller.signal);
    expect(wrapped).toBeInstanceOf(AbortError);
    expect(wrapped.category).toBe("abort");
  });
});
