import { describe, expect, it } from "vitest";

import type { RequestOption } from "../../../contracts/events";

import { resolutionSentence } from "./Approval";

const OPTIONS: readonly RequestOption[] = [
  { id: "allow", label: "Allow once", hint: null },
  { id: "deny", label: "Deny", hint: "The agent stops here" },
];

describe("what a resolved request says happened", () => {
  it("names the option that was chosen", () => {
    expect(resolutionSentence({ kind: "answered", optionId: "deny", text: null }, OPTIONS)).toBe(
      "You chose: Deny",
    );
  });

  it("says only that it was answered when the option is no longer offered", () => {
    expect(resolutionSentence({ kind: "answered", optionId: "retry", text: null }, OPTIONS)).toBe(
      "Answered",
    );
  });

  it("says a dismissal carried no answer", () => {
    expect(resolutionSentence({ kind: "dismissed" }, OPTIONS)).toBe("Dismissed without an answer");
  });

  it("says an expiry ran out first", () => {
    expect(resolutionSentence({ kind: "expired" }, OPTIONS)).toBe("Expired before an answer");
  });
});
