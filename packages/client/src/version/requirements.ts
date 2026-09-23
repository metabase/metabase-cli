import type { FeatureName } from "./features";

// Keyed `<resource>.<method>` as the method is reached on the client, so a key reads the same in a
// command, a skill and an error. An empty list is a promise that every supported server answers. A
// list is ordered strictest-first: the first feature the server lacks is the one the refusal names,
// and naming the lowest floor would send a user through one upgrade only to be refused again.
export const METHOD_REQUIREMENTS = {
  "database.list": [],
  "database.get": [],
  "field.values": [],
  "gitSync.currentTask": ["remoteSync"],
  "gitSync.import": ["remoteSync"],
  "gitSync.branch": [],
  "user.current": [],
} satisfies Record<string, readonly FeatureName[]>;

export type MethodKey = keyof typeof METHOD_REQUIREMENTS;

export function isMethodKey(key: string): key is MethodKey {
  return Object.hasOwn(METHOD_REQUIREMENTS, key);
}

export const METHOD_KEYS: ReadonlyArray<MethodKey> =
  Object.keys(METHOD_REQUIREMENTS).filter(isMethodKey);

export function methodRequirements(key: MethodKey): readonly FeatureName[] {
  return METHOD_REQUIREMENTS[key];
}
