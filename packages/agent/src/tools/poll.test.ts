import { expect, test } from "vitest";
import { pollUntil, resolveTimeoutMs, resolveWait } from "./poll";
import { TeachingError } from "./teaching-error";

test("waiting is the default; only an explicit false opts out", () => {
  expect(resolveWait(undefined)).toBe(true);
  expect(resolveWait(false)).toBe(false);
});

test("a timeout below the floor is raised to it, so a poll always gets one attempt", () => {
  expect(resolveTimeoutMs(0)).toBe(1000);
  expect(resolveTimeoutMs(90_000)).toBe(90_000);
});

test("polling stops at the first value that satisfies the predicate", async () => {
  const statuses = ["started", "started", "succeeded"];
  let attempts = 0;

  const final = await pollUntil(
    () => {
      const status = statuses[attempts] ?? "succeeded";
      attempts += 1;
      return Promise.resolve(status);
    },
    (status) => status === "succeeded",
    { timeoutMs: 5000, subject: "Run 1", recheck: '{action: "get_run", id: 1}' },
  );

  expect(final).toBe("succeeded");
  expect(attempts).toBe(3);
});

test("a timeout says the work is still running and names the call that re-checks it", async () => {
  await expect(
    pollUntil(
      () => Promise.resolve("started"),
      (status) => status === "succeeded",
      { timeoutMs: 1000, subject: "Run 1 of transform 4", recheck: '{action: "get_run", id: 1}' },
    ),
  ).rejects.toThrow(
    new TeachingError(
      'Run 1 of transform 4 is still running after 1s. It has not failed — it is still going server-side. Check on it with `{action: "get_run", id: 1}`, or raise `timeout_ms`.',
    ),
  );
});
