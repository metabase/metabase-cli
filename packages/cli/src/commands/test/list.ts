import { DATA_TEST_TYPES, DataTestType, testedEntityId } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import { isUnsupportedTestType } from "../../core/data-test";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { TestListItem, testListItemView } from "../../output/views/data-test";
import { windowList } from "../../output/window";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { parseEntityRef } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

// The types whose list leaves out the tests of an archived entity unless asked.
const ARCHIVABLE_TYPES: readonly DataTestType[] = ["card", "segment"];

function isArchivable(type: DataTestType): boolean {
  return ARCHIVABLE_TYPES.includes(type);
}

export const TestListEnvelope = listEnvelopeSchema(TestListItem);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List data tests of every type" },
  details:
    "One row per test, with its `test_type` and the id of the entity it tests as `target_id`; `<test_type>-test:<id>` names the test to `get`, `update`, `delete` and `run`. Without --id or --type, a type the server is too old to test is left out.",
  requires: ["dataTest.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "string", description: "Only the tests of this entity, such as card:12" },
    type: {
      type: "string",
      description: `Only tests of this type: ${DATA_TEST_TYPES.join(", ")}`,
    },
    "include-archived": {
      type: "boolean",
      description: `Also list the tests of archived entities (${ARCHIVABLE_TYPES.join(" and ")} tests only)`,
    },
  },
  outputSchema: TestListEnvelope,
  examples: [
    "mb test list",
    "mb test list --id card:12",
    "mb test list --type segment --include-archived --json",
  ],
  async run({ args, ctx, getClient }) {
    const entity = args.id === undefined ? null : parseEntityRef(args.id);
    const onlyType =
      args.type === undefined ? null : parseEnumFlag(args.type, DataTestType, "--type");
    if (entity !== null && onlyType !== null && entity.type !== onlyType) {
      throw new ConfigError(`--id ${args.id} is not of type ${onlyType}; drop --type or --id`);
    }
    const includeArchived = args["include-archived"] === true;
    const named = entity?.type ?? onlyType;
    if (includeArchived && named !== null && !isArchivable(named)) {
      throw new ConfigError(
        `--include-archived takes ${ARCHIVABLE_TYPES.join(" or ")} tests; a ${named} test has no archived entity to include`,
      );
    }
    const client = await getClient();
    async function testsOf<T extends DataTestType>(
      type: T,
      entityId: number | null,
    ): Promise<TestListItem[]> {
      const params = includeArchived && isArchivable(type) ? { "include-archived": true } : {};
      const { data } = await client.dataTest.list(type, entityId, params, {
        signal: interruptSignal,
      });
      return data.map((test) => ({
        test_type: type,
        id: test.id,
        target_id: testedEntityId(type, test),
        name: test.name,
        description: test.description,
      }));
    }

    async function testsOfEveryType(): Promise<TestListItem[]> {
      const lists = await Promise.all(
        DATA_TEST_TYPES.map(async (type) => {
          try {
            return await testsOf(type, null);
          } catch (error) {
            if (isUnsupportedTestType(type, error)) {
              return [];
            }
            throw error;
          }
        }),
      );
      return lists.flat();
    }
    function listed(): Promise<TestListItem[]> {
      if (entity !== null) {
        return testsOf(entity.type, entity.id);
      }
      return onlyType === null ? testsOfEveryType() : testsOf(onlyType, null);
    }
    const items = await listed();
    renderList(windowList(items, ctx.range), testListItemView, ctx);
  },
});
