import type { FlagValues } from "./flag-values";

import { parseOptionalInteger } from "./parse-integer";
import { parseOptionalText } from "./parse-text";

export const copyFlags = {
  name: { type: "string", description: "Name for the copy (default: the source name)" },
  "collection-id": { type: "string", description: "Collection to copy into (default: root)" },
  "collection-position": {
    type: "string",
    description: "Pin the copy at this position in the collection",
  },
} as const;

interface CopyTarget {
  name: string | undefined;
  collection_id: number | null;
  collection_position: number | null;
}

export function parseCopyFlags(args: FlagValues<typeof copyFlags>): CopyTarget {
  return {
    name: parseOptionalText(args.name, "--name"),
    collection_id: parseOptionalInteger(args["collection-id"], { name: "--collection-id", min: 1 }),
    collection_position: parseOptionalInteger(args["collection-position"], {
      name: "--collection-position",
      min: 1,
    }),
  };
}
