import { randomBytes } from "node:crypto";

import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { writeJson, writeText } from "../output/render";

import { outputFlags } from "./flags";
import { parseInteger } from "./parse-integer";
import { defineMetabaseCommand } from "./runtime";

export const MAX_COUNT = 10_000;

const NANO_ID_LENGTH = 21;
const NANO_ID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const NANO_ID_SYMBOL_MASK = 63;

export const NanoIdList = z.array(z.string().regex(/^[A-Za-z0-9_-]{21}$/));

export function nanoId(): string {
  return Array.from(
    randomBytes(NANO_ID_LENGTH),
    (byte) => NANO_ID_ALPHABET[byte & NANO_ID_SYMBOL_MASK],
  ).join("");
}

export default defineMetabaseCommand({
  meta: {
    name: "nano-id",
    description: "Mint random NanoIDs, the entity IDs Metabase serializes content by",
  },
  details:
    "For the values that must be an entity ID: the `entityId` of a data app's `defineQuery` and `defineAction` definitions.",
  skills: [
    { skill: "data-app-data", purpose: "the entity IDs of a data app's questions and actions" },
  ],
  requires: null,
  args: {
    ...outputFlags,
    count: {
      type: "string",
      description: `How many NanoIDs to mint (default 1, max ${MAX_COUNT})`,
      default: "1",
    },
  },
  outputSchema: NanoIdList,
  examples: ["mb nano-id", "mb nano-id --count 5", "mb nano-id --count 5 --json"],
  run({ args, ctx }) {
    const count = parseInteger(args.count, { name: "--count", min: 1 });
    if (count > MAX_COUNT) {
      throw new ConfigError(`invalid --count: ${count} (must be ≤ ${MAX_COUNT})`);
    }
    const ids = Array.from({ length: count }, () => nanoId());
    if (ctx.format === "json") {
      writeJson(ids);
      return;
    }
    writeText(ids.join("\n"));
  },
});
