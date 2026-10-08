import { CollectionNamespace } from "@metabase/client/domain/collection";

import { parseEnumFlag } from "../parse-enum";

export const namespaceFlag = {
  namespace: {
    type: "string",
    description: `Collection namespace: ${CollectionNamespace.options.join("|")} (omit for normal collections)`,
  },
} as const;

/** The namespace a `--namespace` flag names, or `undefined` when it is absent or empty. */
export function parseNamespaceFlag(value: unknown): CollectionNamespace | undefined {
  if (typeof value !== "string" || value === "") {
    return undefined;
  }
  return parseEnumFlag(value, CollectionNamespace, "namespace");
}
