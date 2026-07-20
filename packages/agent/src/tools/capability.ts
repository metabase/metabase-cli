import type { InstanceContext } from "../metabase/probe";
import { TeachingError } from "./teaching-error";

export interface ToolCapabilities {
  minVersion?: number;
  tokenFeature?: string;
}

/**
 * The gap between what a tool needs and what the instance offers, or `null` when the instance
 * satisfies it — and also `null` when the probe never ran: an unprobed instance cannot refute a
 * requirement, so the tool runs and the server's own answer decides.
 */
export function capabilityGap(
  instance: InstanceContext,
  required: ToolCapabilities,
): string | null {
  const { minVersion, tokenFeature } = required;
  if (
    minVersion !== undefined &&
    instance.majorVersion !== null &&
    instance.majorVersion < minVersion
  ) {
    return `needs Metabase v${String(minVersion)} or newer; this instance is ${instance.versionTag ?? `v${String(instance.majorVersion)}`}`;
  }
  if (
    tokenFeature !== undefined &&
    instance.tokenFeatures !== null &&
    !instance.tokenFeatures.includes(tokenFeature)
  ) {
    return `needs the \`${tokenFeature}\` paid feature, which this instance does not have enabled`;
  }
  return null;
}

export function supportsCapabilities(
  instance: InstanceContext,
  required: ToolCapabilities,
): boolean {
  return capabilityGap(instance, required) === null;
}

export function assertCapabilities(
  instance: InstanceContext,
  required: ToolCapabilities,
  toolName: string,
): void {
  const gap = capabilityGap(instance, required);
  if (gap !== null) {
    throw new TeachingError(`\`${toolName}\` ${gap}. There is no workaround from this session.`);
  }
}
