import { ConfigError } from "@metabase/client/errors";
import { isBlank } from "@metabase/client/predicates";

export function branchFlag(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (isBlank(value)) {
    throw new ConfigError("invalid --branch: branch name must not be blank");
  }
  return value;
}
