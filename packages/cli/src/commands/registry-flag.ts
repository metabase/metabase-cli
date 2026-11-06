import { DEFAULT_REGISTRY, type FetchDistTagsOptions } from "../core/npm-registry";
import { USER_AGENT } from "../core/user-agent";
import { interruptSignal } from "../runtime/interrupt";

export const registryFlag = {
  registry: {
    type: "string",
    description: `npm registry URL (default: ${DEFAULT_REGISTRY})`,
  },
} as const;

export function distTagsOptions(registryArg: string | undefined): FetchDistTagsOptions {
  const registry = registryArg?.trim();
  if (registry === undefined || registry === "") {
    return { userAgent: USER_AGENT, signal: interruptSignal };
  }
  return { userAgent: USER_AGENT, registry, signal: interruptSignal };
}
