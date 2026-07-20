import { expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { runGetParameterValuesTool } from "./get-parameter-values";
import { TeachingError } from "./teaching-error";

const VALUES = { values: [["A"], ["B"]], has_more_values: false };

test("rejects constraints for a question target", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(
    runGetParameterValuesTool(deps, {
      target: "question",
      id: 5,
      parameter_id: "cat",
      constraints: { x: "1" },
    }),
  ).rejects.toBeInstanceOf(TeachingError);
  await expect(
    runGetParameterValuesTool(deps, {
      target: "question",
      id: 5,
      parameter_id: "cat",
      constraints: { x: "1" },
    }),
  ).rejects.toThrow(
    '`constraints` is only supported for dashboard parameters — the question values endpoint takes none. Drop `constraints` or set `target: "dashboard"`.',
  );
});

test("fetches dashboard values, chaining constraints as query params", async () => {
  const handler: Responder = (path, options) => {
    expect(path).toBe("/api/dashboard/3/params/abc/values");
    expect(options?.query).toEqual({ def: "100" });
    return VALUES;
  };
  const { deps } = toolDeps(handler);
  const result = await runGetParameterValuesTool(deps, {
    target: "dashboard",
    id: 3,
    parameter_id: "abc",
    constraints: { def: "100" },
  });
  expect(result.details).toEqual({ kind: "json", label: "2 values for abc", value: VALUES });
});

test("builds the search path for a prefix query", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/card/5/params/cat/search/Gi");
    return VALUES;
  };
  const { deps } = toolDeps(handler);
  const result = await runGetParameterValuesTool(deps, {
    target: "question",
    id: 5,
    parameter_id: "cat",
    query: "Gi",
  });
  expect(result.details).toEqual({ kind: "json", label: "2 values for cat", value: VALUES });
});
