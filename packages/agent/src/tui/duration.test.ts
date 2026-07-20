import { expect, test } from "vitest";
import { formatDuration } from "./duration";

test("a short call keeps a tenth of a second; a long one does not pretend to that precision", () => {
  expect(formatDuration(1_240)).toBe("1.2s");
  expect(formatDuration(23_400)).toBe("23s");
  expect(formatDuration(92_000)).toBe("1m 32s");
});
