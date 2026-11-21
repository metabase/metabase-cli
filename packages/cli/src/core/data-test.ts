import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  DATA_TEST_TYPES,
  type DataTestType,
} from "@metabase/client/domain/data-test";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";
import type { FeatureName } from "@metabase/client/version/features";

export const TEST_SUFFIX = "-test";

type TestKind = `${DataTestType}${typeof TEST_SUFFIX}`;

// The name a test of `type` goes by (`card-test`), in a ref and as a CI check's kind.
export function testKind(type: DataTestType): TestKind {
  return `${type}${TEST_SUFFIX}`;
}

export const TEST_KINDS: readonly TestKind[] = DATA_TEST_TYPES.map(testKind);

const { transform, card, segment, measure, action } = DATA_TEST_SCHEMAS;
export const AnyTest = z.union([transform, card, segment, measure, action]);
export type AnyTest = z.infer<typeof AnyTest>;

// Every test type needs the data testing transform tests introduced, so a server refusing that, or
// lacking the license for any of them, cannot test anything and says so as an error.
const DATA_TESTING_FEATURE: FeatureName = "transformTests";

// A server too old for a test type, or without its route yet, holds no test of it.
export function isUnsupportedTestType(type: DataTestType, error: unknown): boolean {
  if (type === "transform") {
    return false;
  }
  if (error instanceof CapabilityError) {
    const { feature, reason } = error.developerDetail;
    return feature !== DATA_TESTING_FEATURE && reason === "version-too-old";
  }
  return error instanceof HttpError && error.kind === "route-missing";
}
