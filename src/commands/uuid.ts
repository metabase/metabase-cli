import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConfigError } from "../core/errors";
import { writeJson, writeText } from "../output/render";

import { outputFlags } from "./flags";
import { parseInteger } from "./parse-integer";
import { defineMetabaseCommand } from "./runtime";

export const MAX_COUNT = 10_000;

export const UuidList = z.array(z.string().uuid());

export default defineMetabaseCommand({
  meta: {
    name: "uuid",
    description:
      'Mint UUID v4 strings (Node crypto.randomUUID) for MBQL `lib/uuid` slots, native template-tag ids, etc. Agents must call this to obtain UUIDs rather than authoring them by hand — hand-written placeholders fail the bundled MBQL 5 schema\'s `format: "uuid"` check.',
  },
  args: {
    ...outputFlags,
    count: {
      type: "string",
      description: `How many UUIDs to mint (default 1, max ${MAX_COUNT})`,
      default: "1",
    },
  },
  outputSchema: UuidList,
  examples: ["metabase uuid", "metabase uuid --count 5", "metabase uuid --count 5 --json"],
  run({ args, ctx }) {
    const count = parseInteger(args.count, { name: "--count", min: 1 });
    if (count > MAX_COUNT) {
      throw new ConfigError(`invalid --count: ${count} (must be ≤ ${MAX_COUNT})`);
    }
    const uuids = Array.from({ length: count }, () => randomUUID());
    if (ctx.format === "json") {
      writeJson(uuids);
      return;
    }
    writeText(uuids.join("\n"));
  },
});
