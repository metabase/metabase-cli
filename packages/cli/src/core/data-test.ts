import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  DATA_TEST_TYPES,
  type DataTestType,
} from "@metabase/client/domain/data-test";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

export const TEST_SUFFIX = "-test";

export type TestKind = `${DataTestType}${typeof TEST_SUFFIX}`;

// The name a test of `type` goes by (`card-test`), in a ref and as a CI check's kind.
export function testKind(type: DataTestType): TestKind {
  return `${type}${TEST_SUFFIX}`;
}

export const TEST_KINDS: readonly TestKind[] = DATA_TEST_TYPES.map(testKind);

const { transform, card, segment, measure, action } = DATA_TEST_SCHEMAS;
export const AnyTest = z.union([transform, card, segment, measure, action]);
export type AnyTest = z.infer<typeof AnyTest>;

// A server without a test type, or without its route yet, holds no test of it.
export function isUnsupportedTestType(error: unknown): error is CapabilityError | HttpError {
  return (
    error instanceof CapabilityError ||
    (error instanceof HttpError && error.kind === "route-missing")
  );
}
