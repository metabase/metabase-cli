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

export function requireTrackedBranch(tracked: string | null): string {
  if (tracked === null) {
    throw new ConfigError("git-sync tracks no branch: the remote-sync-branch setting is unset");
  }
  return tracked;
}
