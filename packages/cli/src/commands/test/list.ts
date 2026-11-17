import { DATA_TEST_TYPES, DataTestType } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import { isUnsupportedTestType } from "../../core/ci-unit";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { type AnyTest, TestListItem, testListItemView } from "../../output/views/data-test";
import { windowList } from "../../output/window";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { parseEntityRef } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export const TestListEnvelope = listEnvelopeSchema(TestListItem);

type TestRow = Pick<AnyTest, "id" | "name" | "description">;

function row(type: DataTestType, targetId: number, test: TestRow): TestListItem {
  return {
    test_type: type,
    id: test.id,
    target_id: targetId,
    name: test.name,
    description: test.description,
  };
}

export default defineMetabaseCommand({
  meta: { name: "list", description: "List data tests of every type" },
  details:
    "Lists every test the caller can read, one row per test with its `test_type` and the id of the entity it tests as `target_id`. --id narrows to the tests of one entity, written `<type>:<id>` (`card:12`); --type narrows to one type. Without either, a type the server does not support is left out.",
  requires: [
    "transformTest.list",
    "cardTest.list",
    "segmentTest.list",
    "measureTest.list",
    "actionTest.list",
  ],
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
  },
  outputSchema: TestListEnvelope,
  examples: ["mb test list", "mb test list --id card:12", "mb test list --type segment --json"],
  async run({ args, ctx, getClient }) {
    const entity = args.id === undefined ? null : parseEntityRef(args.id);
    const onlyType =
      args.type === undefined ? null : parseEnumFlag(args.type, DataTestType, "--type");
    if (entity !== null && onlyType !== null && entity.type !== onlyType) {
      throw new ConfigError(`--id ${args.id} is not a ${onlyType}; drop --type or --id`);
    }
    const client = await getClient();
    async function testsOf(
      type: DataTestType,
      entityId: number | undefined,
    ): Promise<TestListItem[]> {
      const options = { signal: interruptSignal };
      switch (type) {
        case "transform": {
          const { data } = await client.transformTest.list({ "transform-id": entityId }, options);
          return data.map((test) => row(type, test.transform_id, test));
        }
        case "card": {
          const { data } = await client.cardTest.list({ "card-id": entityId }, options);
          return data.map((test) => row(type, test.card_id, test));
        }
        case "segment": {
          const { data } = await client.segmentTest.list({ "segment-id": entityId }, options);
          return data.map((test) => row(type, test.segment_id, test));
        }
        case "measure": {
          const { data } = await client.measureTest.list({ "measure-id": entityId }, options);
          return data.map((test) => row(type, test.measure_id, test));
        }
        case "action": {
          const { data } = await client.actionTest.list({ "action-id": entityId }, options);
          return data.map((test) => row(type, test.action_id, test));
        }
      }
    }

    async function testsOfEveryType(): Promise<TestListItem[]> {
      const lists = await Promise.all(
        DATA_TEST_TYPES.map(async (type) => {
          try {
            return await testsOf(type, undefined);
          } catch (error) {
            if (isUnsupportedTestType(error)) {
              return [];
            }
            throw error;
          }
        }),
      );
      return lists.flat();
    }
    const narrowed = entity?.type ?? onlyType;
    const items =
      narrowed === null ? await testsOfEveryType() : await testsOf(narrowed, entity?.id);
    renderList(windowList(items, ctx.range), testListItemView, ctx);
  },
});
