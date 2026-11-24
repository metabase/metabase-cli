import type { FlagValues } from "../flag-values";
import type { BodyReader } from "../runtime";

import { GlossaryCreateInput } from "@metabase/client/domain/glossary";
import { ConfigError } from "@metabase/client/errors";

import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";
import { parseTextFlag } from "../parse-text";

export const entryFlags = {
  ...bodyInputFlags,
  term: { type: "string", description: "The term (used with --definition)" },
  definition: { type: "string", description: "The definition (used with --term)" },
} as const;

/**
 * The flag pair and a body are alternatives, so a `--body` or `--file` beside the flags is refused
 * rather than dropped. A body piped on stdin is not read while the flags are given: telling an
 * idle inherited pipe from one still to send would cost every flag-driven call the stdin wait.
 */
export async function readEntryInput(
  args: FlagValues<typeof entryFlags>,
  readBody: BodyReader<GlossaryCreateInput>,
): Promise<GlossaryCreateInput> {
  if (args.term === undefined && args.definition === undefined) {
    return readBody({ flag: args.body, file: args.file });
  }
  if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
    throw new ConfigError("--term, --definition cannot be combined with --body or --file");
  }
  if (args.term === undefined) {
    throw new ConfigError("--term is required when using --definition");
  }
  if (args.definition === undefined) {
    throw new ConfigError("--definition is required when using --term");
  }
  return {
    term: parseTextFlag(args.term, GlossaryCreateInput.shape.term, "--term"),
    definition: parseTextFlag(
      args.definition,
      GlossaryCreateInput.shape.definition,
      "--definition",
    ),
  };
}
