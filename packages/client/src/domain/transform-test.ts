import { z } from "zod";

import { DATA_TEST_SCHEMAS, DataTestDefinitionWithNow } from "./data-test";

export const TransformTest = DATA_TEST_SCHEMAS.transform;
export type TransformTest = z.infer<typeof TransformTest>;

export const TransformTestCompact = TransformTest.pick({
  id: true,
  transform_id: true,
  name: true,
  description: true,
  now: true,
}).strip();
export type TransformTestCompact = z.infer<typeof TransformTestCompact>;

/**
 * The server closes this map, so an unrecognized key is a 400 there. Refusing it here names the key
 * instead: a body cloned from `get` has to shed `id`, `entity_id`, `creator_id`, `created_at` and
 * `updated_at` before it can be sent back.
 */
export const TransformTestCreateInput = DataTestDefinitionWithNow.extend({
  transform_id: z.number().int().positive(),
}).strict();
export type TransformTestCreateInput = z.infer<typeof TransformTestCreateInput>;

/** Closed for the same reason as [[TransformTestCreateInput]]; every field is optional. */
export const TransformTestUpdateInput = TransformTestCreateInput.partial().strict();
export type TransformTestUpdateInput = z.infer<typeof TransformTestUpdateInput>;

export const TransformTestRefusalCode = z.enum([
  "transform-test.unknown-column",
  "transform-test.ambiguous-column",
  "transform-test.missing-inputs",
  "transform-test.unused-inputs",
  "transform-test.duplicate-input-table",
  "transform-test.unparseable-source",
  "transform-test.unremapped-reference",
  "transform-test.unsupported-transform",
  "transform-test.unsupported-driver",
  "transform-test.transform-failed",
  "transform-test.setup-failed",
  "transform-test.expectation-failed",
  "transform-test.unsupported-format",
  "transform-test.now-on-native-sql",
]);
export type TransformTestRefusalCode = z.infer<typeof TransformTestRefusalCode>;

export function isTransformTestRefusalCode(value: string): value is TransformTestRefusalCode {
  return TransformTestRefusalCode.safeParse(value).success;
}

const TRANSFORM_TEST_CODE_PREFIX = "transform-test.";

// Every code the server publishes for transform testing, including ones newer than
// `TransformTestRefusalCode`.
export function isTransformTestCode(value: string): boolean {
  return value.startsWith(TRANSFORM_TEST_CODE_PREFIX);
}
