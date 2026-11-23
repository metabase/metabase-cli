import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { writeJson, writeText } from "../output/render";

import { outputFlags } from "./flags";
import { parseInteger } from "./parse-integer";
import { defineMetabaseCommand } from "./runtime";

export const MAX_COUNT = 10_000;

export const UuidList = z.array(z.string().uuid());

export default defineMetabaseCommand({
  meta: {
    name: "uuid",
    description: "Mint random UUID v4 strings",
  },
  details:
    "Use them where a value needs a fresh unique id: the `lib/uuid` of an aggregation that an MBQL aggregation ref points at, and a document node's `_id`. The MBQL pre-flight rejects a hand-written placeholder (`a1`, `uuid-1`) in a `lib/uuid`. Text output prints one UUID per line, JSON a string array.",
  skills: [
    { skill: "mbql", purpose: "aggregation refs" },
    { skill: "document", purpose: "document node ids" },
  ],
  requires: null,
  args: {
    ...outputFlags,
    count: {
      type: "string",
      description: `How many UUIDs to mint (max ${MAX_COUNT})`,
      default: "1",
    },
  },
  outputSchema: UuidList,
  examples: [
    "mb uuid",
    "mb uuid --count 5",
    "mb uuid --count 5 --json",
    "mb uuid --count 5 --format text",
    "U=$(mb uuid --format text)",
  ],
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
