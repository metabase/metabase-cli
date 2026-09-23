import { randomBytes } from "node:crypto";
import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { writeJson, writeText } from "../output/render";

import { outputFlags } from "./flags";
import { parseInteger } from "./parse-integer";
import { defineMetabaseCommand } from "./runtime";

export const MAX_COUNT = 10_000;

// The NanoID alphabet and length `@metabase/representations` uses for `entity_id`: 64 symbols, so
// six bits of each random byte pick one without bias.
export const ENTITY_ID_ALPHABET =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
export const ENTITY_ID_LENGTH = 21;
const ALPHABET_MASK = 0x3f;

export const EntityIdList = z.array(z.string().regex(/^[A-Za-z0-9_-]{21}$/u));

export function mintEntityId(): string {
  const bytes = randomBytes(ENTITY_ID_LENGTH);
  let id = "";
  for (const byte of bytes) {
    id += ENTITY_ID_ALPHABET.charAt(byte & ALPHABET_MASK);
  }
  return id;
}

export default defineMetabaseCommand({
  meta: {
    name: "entity-id",
    description: "Mint entity ids for new content files",
  },
  details:
    "A 21-character NanoID over `A-Za-z0-9_-`, the `entity_id` every content file carries and the value other files reference it by. Mint fresh values here rather than authoring them by hand.",
  skills: [{ skill: "core", purpose: "where entity ids are used" }],
  requires: null,
  args: {
    ...outputFlags,
    count: {
      type: "string",
      description: `How many ids to mint (default 1, max ${MAX_COUNT})`,
      default: "1",
    },
  },
  outputSchema: EntityIdList,
  examples: ["mb entity-id", "mb entity-id --count 5", "mb entity-id --count 5 --json"],
  run({ args, ctx }) {
    const count = parseInteger(args.count, { name: "--count", min: 1 });
    if (count > MAX_COUNT) {
      throw new ConfigError(`invalid --count: ${count} (must be ≤ ${MAX_COUNT})`);
    }
    const ids = Array.from({ length: count }, () => mintEntityId());
    if (ctx.format === "json") {
      writeJson(ids);
      return;
    }
    writeText(ids.join("\n"));
  },
});
