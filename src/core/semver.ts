import { compare, valid } from "semver";
import { z } from "zod";

const SEMVER_MESSAGE = "expected semver MAJOR.MINOR.PATCH[-prerelease][+build]";

export const SemverString = z.string().refine((value) => valid(value) !== null, {
  message: SEMVER_MESSAGE,
});

export type Ordering = -1 | 0 | 1;

export function compareSemver(a: string, b: string): Ordering {
  return compare(a, b);
}
