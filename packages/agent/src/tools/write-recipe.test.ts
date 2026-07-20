import { expect, test } from "vitest";
import { TeachingError } from "./teaching-error";
import { assertExactlyOneOf, assertMethodRequirements, methodSchema } from "./write-recipe";

interface CardWrite {
  method: "create" | "update";
  id?: number | null;
  name?: string;
  query_file?: string;
  query?: object;
  native?: object;
}

interface MisnamedWrite {
  method: "update";
  id?: number;
  card_id: number;
  display: string;
}

const REQUIREMENTS = { create: ["name"], update: ["id"] } as const;

test("methodSchema is a flat string enum", () => {
  expect(methodSchema).toEqual({
    type: "string",
    enum: ["create", "update"],
    description:
      "`create` a new entity or `update` an existing one. Per-method required fields are named in each parameter's description; supplying the wrong set returns a teaching error naming the missing field.",
  });
});

test("throws a teaching error naming the field missing for create", () => {
  const params: CardWrite = { method: "create" };
  expect(() => assertMethodRequirements("create", params, REQUIREMENTS)).toThrow(TeachingError);
  expect(() => assertMethodRequirements("create", params, REQUIREMENTS)).toThrow(
    "`name` is required for the `create` method.",
  );
});

test("tells the model where an id comes from when update is missing one", () => {
  const params: MisnamedWrite = { method: "update", card_id: 236, display: "scalar" };
  expect(() => assertMethodRequirements("update", params, { update: ["id"] })).toThrow(
    '`id` is required for the `update` method. This call carried `method`, `card_id`, `display` and nothing else. An id is the entity\'s numeric id, not its name — look it up with `search`, `browse_collection`, or `browse_data` and pass the `id` you get back. To make a new entity instead, use `method: "create"`.',
  );
});

test("a call addressing an entity by name hears that a name selects nothing", () => {
  const params: CardWrite = { method: "update", name: "Q1" };
  expect(() => assertMethodRequirements("update", params, REQUIREMENTS)).toThrow(
    '`id` is required for the `update` method. This call carried `method`, `name` and nothing else. `name` does not select an entity — on `update` it is the new title to write. Use the numeric `id` that came back in the result of the write that created it, or look it up with `search`, `browse_collection`, or `browse_data`. To make a new entity instead, use `method: "create"`.',
  );
});

test("reads back a bare call, whose arguments never arrived whole", () => {
  const params: CardWrite = { method: "update" };
  expect(() => assertMethodRequirements("update", params, REQUIREMENTS)).toThrow(
    "This call carried `method` and nothing else.",
  );
});

test("names every missing field in one error", () => {
  const params: CardWrite = { method: "create" };
  expect(() =>
    assertMethodRequirements("create", params, { create: ["name", "query_file"] }),
  ).toThrow("`name`, `query_file` are required for the `create` method.");
});

test("accepts a request that satisfies its per-method requirements", () => {
  const params: CardWrite = { method: "create", name: "Q1" };
  expect(() => assertMethodRequirements("create", params, REQUIREMENTS)).not.toThrow();
});

test("treats null as absent for a required field", () => {
  const params: CardWrite = { method: "update", id: null };
  expect(() => assertMethodRequirements("update", params, REQUIREMENTS)).toThrow(
    "`id` is required for the `update` method.",
  );
});

test("rejects zero provided sources when exactly one is required", () => {
  const params: CardWrite = { method: "create", name: "Q1" };
  expect(() =>
    assertExactlyOneOf(params, ["query", "query_file", "native"], "query source"),
  ).toThrow("Provide exactly one query source (query, query_file, native); received 0.");
});

test("rejects multiple provided sources when exactly one is required", () => {
  const params: CardWrite = { method: "create", name: "Q1", query: {}, native: {} };
  expect(() =>
    assertExactlyOneOf(params, ["query", "query_file", "native"], "query source"),
  ).toThrow("Provide exactly one query source (query, query_file, native); received 2.");
});

test("accepts exactly one provided source", () => {
  const params: CardWrite = { method: "create", name: "Q1", query: {} };
  expect(() =>
    assertExactlyOneOf(params, ["query", "query_file", "native"], "query source"),
  ).not.toThrow();
});
