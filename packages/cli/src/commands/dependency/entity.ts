import { DependencyType } from "@metabase/client/domain/dependency";

import { parseEnumFlag } from "../parse-enum";

export const entityArgs = {
  type: {
    type: "positional",
    description: `Entity kind (${DependencyType.options.join(" | ")})`,
    required: true,
  },
  id: { type: "positional", description: "Entity id", required: true },
} as const;

export function parseDependencyType(value: string): DependencyType {
  return parseEnumFlag(value, DependencyType, "type");
}
