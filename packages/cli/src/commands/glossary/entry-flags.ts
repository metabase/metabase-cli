import type { ZodType } from "zod";

import type { FlagValues } from "../flag-values";

import { GlossaryCreateInput } from "@metabase/client/domain/glossary";
import { ConfigError } from "@metabase/client/errors";

import { readBody } from "../../runtime/body";
import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";

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
): Promise<GlossaryCreateInput> {
  if (args.term === undefined && args.definition === undefined) {
    return readBody({ flag: args.body, file: args.file }, GlossaryCreateInput);
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
    term: parseFlag(GlossaryCreateInput.shape.term, args.term, "--term"),
    definition: parseFlag(GlossaryCreateInput.shape.definition, args.definition, "--definition"),
  };
}

// Each flag runs through the body's own field schema, so both paths refuse the same values.
function parseFlag(schema: ZodType<string>, value: string, flag: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ConfigError(`${flag} ${reasons}`);
  }
  return parsed.data;
}
