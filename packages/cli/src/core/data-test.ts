import { DATA_TEST_TYPES, type DataTestType } from "@metabase/client/domain/data-test";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

const TEST_SUFFIX = "-test";

export type TestKind = `${DataTestType}${typeof TEST_SUFFIX}`;

export function testKind(type: DataTestType): TestKind {
  return `${type}${TEST_SUFFIX}`;
}

export const TEST_KINDS: readonly TestKind[] = DATA_TEST_TYPES.map(testKind);

export function isUnsupportedTestType(error: unknown): error is CapabilityError | HttpError {
  return (
    error instanceof CapabilityError ||
    (error instanceof HttpError && error.kind === "route-missing")
  );
}
