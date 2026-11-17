import { z } from "zod";

import { dataTestBodyFields, DataTestParameters } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import type { DataTestRef } from "../test-ref";

// A test's body without the id of the entity under test, which `--id` names instead. `parameters`
// belongs to an action test alone.
export const TestBody = z
  .object({ ...dataTestBodyFields, parameters: DataTestParameters.optional() })
  .strict();
export type TestBody = z.infer<typeof TestBody>;

export const TestPatch = TestBody.partial().strict();
export type TestPatch = z.infer<typeof TestPatch>;

type BodyField = "now" | "parameters";

// The fields a type's server refuses: a transform test has no `now`, and only an action takes
// `parameters`.
const REFUSED_FIELDS: Record<DataTestRef["type"], readonly BodyField[]> = {
  transform: ["now", "parameters"],
  card: ["parameters"],
  segment: ["parameters"],
  measure: ["parameters"],
  action: [],
};

export function refuseForeignFields(ref: DataTestRef, body: TestPatch): void {
  const present = REFUSED_FIELDS[ref.type].filter((field) => body[field] !== undefined);
  if (present.length > 0) {
    throw new ConfigError(`a ${ref.type} test takes no ${present.join(" or ")}`);
  }
}
