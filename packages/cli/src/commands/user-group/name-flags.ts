import type { FlagValues } from "../flag-values";
import type { BodyReader } from "../runtime";

import { PermissionGroupCreateInput } from "@metabase/client/domain/permission";
import { ConfigError } from "@metabase/client/errors";

import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";
import { parseTextFlag } from "../parse-text";

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
  readBody: BodyReader<PermissionGroupCreateInput>,
): Promise<PermissionGroupCreateInput> {
  if (args.name === undefined) {
    return readBody({ flag: args.body, file: args.file });
  }
  if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
    throw new ConfigError("--name cannot be combined with --body or --file");
  }
  return { name: parseTextFlag(args.name, PermissionGroupCreateInput.shape.name, "--name") };
}
