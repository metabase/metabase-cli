import { DATA_TEST_TYPES, DataTestType } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import { parseId } from "./parse-id";

const ID_FLAG = "--id";
const REF_SEPARATOR = ":";
const TEST_SUFFIX = "-test";

const TYPE_LIST = DATA_TEST_TYPES.join(", ");

// The entity a test checks (`card:12`), or one of its tests (`card-test:34`).
export interface DataTestRef {
  type: DataTestType;
  id: number;
}

interface SplitRef {
  name: string;
  id: number;
}

function splitRef(value: string, expected: string): SplitRef {
  const separator = value.lastIndexOf(REF_SEPARATOR);
  if (separator === -1) {
    throw new ConfigError(`invalid ${ID_FLAG}: "${value}" (expected ${expected})`);
  }
  const id = parseId(value.slice(separator + 1), ID_FLAG);
  return { name: value.slice(0, separator), id };
}

function testType(name: string, value: string, expected: string): DataTestType {
  const parsed = DataTestType.safeParse(name);
  if (!parsed.success) {
    throw new ConfigError(
      `invalid ${ID_FLAG}: "${value}" (expected ${expected}, where <type> is one of: ${TYPE_LIST})`,
    );
  }
  return parsed.data;
}

const ENTITY_FORM = "<type>:<id>, such as card:12";
const TEST_FORM = "<type>-test:<id>, such as card-test:34";

export function parseEntityRef(value: string): DataTestRef {
  const { name, id } = splitRef(value, ENTITY_FORM);
  if (name.endsWith(TEST_SUFFIX)) {
    throw new ConfigError(
      `invalid ${ID_FLAG}: "${value}" names a test; this command takes the entity under test, ${ENTITY_FORM}`,
    );
  }
  return { type: testType(name, value, ENTITY_FORM), id };
}

export function parseTestRef(value: string): DataTestRef {
  const { name, id } = splitRef(value, TEST_FORM);
  if (!name.endsWith(TEST_SUFFIX)) {
    throw new ConfigError(
      `invalid ${ID_FLAG}: "${value}" names an entity; this command takes a test, ${TEST_FORM}`,
    );
  }
  return { type: testType(name.slice(0, -TEST_SUFFIX.length), value, TEST_FORM), id };
}

export function testRefText(ref: DataTestRef): string {
  return `${ref.type}${TEST_SUFFIX}${REF_SEPARATOR}${ref.id}`;
}
