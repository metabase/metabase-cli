import type { z } from "zod";

import { DataTestDefinition, DataTestParameters } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import type { DataTestRef } from "../test-ref";

// A test's body without the id of the entity under test, which `--id` names instead. `parameters`
// belongs to an action test alone.
export const TestBody = DataTestDefinition.extend({
  parameters: DataTestParameters.nullable().optional(),
}).strict();

export const TestPatch = TestBody.partial().strict();
export type TestPatch = z.infer<typeof TestPatch>;

export function refuseForeignFields(ref: DataTestRef, body: TestPatch): void {
  if (ref.type !== "action" && body.parameters !== undefined) {
    throw new ConfigError(`a ${ref.type} test takes no parameters`);
  }
}
