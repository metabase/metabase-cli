import { z } from "zod";

import type { FlagValues } from "../flag-values";

import { CollectionUpdateInput } from "@metabase/client/domain/collection";
import { ConfigError } from "@metabase/client/errors";
import { isBlank } from "@metabase/client/predicates";

import { readBody } from "../../runtime/body";
import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";
import { parseEnumFlag } from "../parse-enum";
import { parseInteger } from "../parse-integer";

const ROOT_PARENT = "root";
const ArchivedWord = z.enum(["true", "false"]);

export const updateFlags = {
  ...bodyInputFlags,
  name: { type: "string", description: "New name" },
  description: { type: "string", description: "New description" },
  "clear-description": { type: "boolean", description: "Remove the description" },
  "parent-id": {
    type: "string",
    description: `Collection to move it under, or '${ROOT_PARENT}' for the top level`,
  },
  archived: {
    type: "string",
    description: "true moves it to the trash, false restores it (default: leave as is)",
  },
} as const;

interface FlagPatch {
  given: string[];
  patch: CollectionUpdateInput;
}

/** A body beside a patch flag would be dropped or half-applied, so the two are alternatives. */
export async function readUpdateInput(
  args: FlagValues<typeof updateFlags>,
): Promise<CollectionUpdateInput> {
  const { given, patch } = patchFromFlags(args);
  if (given.length === 0) {
    return readBody({ flag: args.body, file: args.file }, CollectionUpdateInput);
  }
  if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
    throw new ConfigError(`${given.join(", ")} cannot be combined with --body or --file`);
  }
  return patch;
}

function patchFromFlags(args: FlagValues<typeof updateFlags>): FlagPatch {
  const given: string[] = [];
  const patch: CollectionUpdateInput = {};
  const clearDescription = args["clear-description"] === true;
  if (args.name !== undefined) {
    given.push("--name");
    patch.name = requireText(args.name, "--name");
  }
  if (args.description !== undefined && clearDescription) {
    throw new ConfigError("--description cannot be combined with --clear-description");
  }
  if (args.description !== undefined) {
    given.push("--description");
    patch.description = requireText(args.description, "--description");
  }
  if (clearDescription) {
    given.push("--clear-description");
    patch.description = null;
  }
  if (args["parent-id"] !== undefined) {
    given.push("--parent-id");
    patch.parent_id = parseParentId(args["parent-id"]);
  }
  if (args.archived !== undefined) {
    given.push("--archived");
    patch.archived = parseEnumFlag(args.archived, ArchivedWord, "--archived") === "true";
  }
  return { given, patch };
}

function requireText(value: string, flag: string): string {
  if (isBlank(value)) {
    throw new ConfigError(`${flag} must not be blank`);
  }
  return value;
}

function parseParentId(value: string): number | null {
  if (value === ROOT_PARENT) {
    return null;
  }
  return parseInteger(value, {
    name: "--parent-id",
    min: 1,
    expected: `integer or "${ROOT_PARENT}"`,
  });
}
