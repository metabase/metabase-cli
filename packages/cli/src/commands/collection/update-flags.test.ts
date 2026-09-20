import { describe, expect, it } from "vitest";

import type { CollectionUpdateInput } from "@metabase/client/domain/collection";
import { ConfigError } from "@metabase/client/errors";

import type { FlagValues } from "../flag-values";

import { readUpdateInput, type updateFlags } from "./update-flags";

type UpdateArgs = Partial<FlagValues<typeof updateFlags>>;

function read(overrides: UpdateArgs): Promise<CollectionUpdateInput> {
  return readUpdateInput({
    body: undefined,
    file: undefined,
    name: undefined,
    description: undefined,
    "clear-description": undefined,
    "parent-id": undefined,
    archived: undefined,
    ...overrides,
  });
}

async function refusal(overrides: UpdateArgs): Promise<string> {
  try {
    await read(overrides);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("readUpdateInput", () => {
  it("builds the patch from the flags that were given and nothing else", async () => {
    await expect(read({ name: "Marketing", description: "Campaigns" })).resolves.toEqual({
      name: "Marketing",
      description: "Campaigns",
    });
  });

  it("moves under a parent by id and to the top level with root", async () => {
    await expect(read({ "parent-id": "7" })).resolves.toEqual({ parent_id: 7 });
    await expect(read({ "parent-id": "root" })).resolves.toEqual({ parent_id: null });
  });

  it("refuses a parent id that is neither an integer nor root", async () => {
    await expect(refusal({ "parent-id": "trash" })).resolves.toBe(
      'invalid --parent-id: "trash" (expected integer or "root")',
    );
  });

  it("refuses an empty name or description rather than treating it as absent", async () => {
    await expect(refusal({ name: "" })).resolves.toBe("--name must not be blank");
    await expect(refusal({ description: "" })).resolves.toBe("--description must not be blank");
  });

  it("reads the JSON body when no patch flag is given", async () => {
    await expect(read({ body: '{"parent_id":null,"archived":true}' })).resolves.toEqual({
      parent_id: null,
      archived: true,
    });
  });

  it("refuses a body beside a patch flag, naming every flag given", async () => {
    await expect(refusal({ name: "x", "parent-id": "2", body: '{"name":"y"}' })).resolves.toBe(
      "--name, --parent-id cannot be combined with --body or --file",
    );
    await expect(refusal({ description: "x", file: "patch.json" })).resolves.toBe(
      "--description cannot be combined with --body or --file",
    );
  });
});
