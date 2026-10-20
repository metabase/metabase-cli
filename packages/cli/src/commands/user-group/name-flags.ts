import type { FlagValues } from "../flag-values";

import { GroupCreateInput } from "@metabase/client/domain/group";
import { ConfigError } from "@metabase/client/errors";

import { readBody } from "../../runtime/body";
import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";

export const nameFlags = {
  ...bodyInputFlags,
  name: { type: "string", description: "The group name" },
} as const;

/**
 * `--name` and a body are alternatives, so a `--body` or `--file` beside the flag is refused rather
 * than dropped. A body piped on stdin is not read while the flag is given.
 */
export async function readGroupInput(
  args: FlagValues<typeof nameFlags>,
): Promise<GroupCreateInput> {
  if (args.name === undefined) {
    return readBody({ flag: args.body, file: args.file }, GroupCreateInput);
  }
  if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
    throw new ConfigError("--name cannot be combined with --body or --file");
  }
  // The flag runs through the body's own schema, so both paths refuse the same values.
  const parsed = GroupCreateInput.shape.name.safeParse(args.name);
  if (!parsed.success) {
    throw new ConfigError(`--name ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { name: parsed.data };
}
