import { DependencyType } from "@metabase/client/domain/dependency";
import { featureAvailability } from "@metabase/client/version/features";

import { parseEnumFlag } from "../parse-enum";

export const entityArgs = {
  type: {
    type: "positional",
    description: `Entity kind (${DependencyType.options.join(" | ")}). A \`measure\` needs ${featureAvailability("measureDependencyGraph")}, an \`action\` ${featureAvailability("actionDependencyGraph")}`,
    required: true,
  },
  id: { type: "positional", description: "Entity id", required: true },
} as const;

export function parseDependencyType(value: string): DependencyType {
  return parseEnumFlag(value, DependencyType, "type");
}
