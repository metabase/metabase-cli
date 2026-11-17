import { renderSummary } from "../../output/render";
import { AnyTest, anyTestView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEntityRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";
import { refuseForeignFields, TestBody } from "./body";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data test from JSON" },
  details:
    '--id names the entity under test as `<type>:<id>` (`card:12`), so the body leaves out its id. The JSON body needs a `name`, the `inputs` standing in for every table the entity reads, and the `expectations` checked against its output. An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` and `rows`. An expectation is either `type: "empty"` with the `sql` that must return nothing, or `type: "equals"` with the `columns` and `rows` the output must hold exactly. `now` fixes the time relative date filters read (not on a transform test); `parameters` are the values an action test calls its action with. The body is closed at every level.',
  requires: [
    "transformTest.create",
    "cardTest.create",
    "segmentTest.create",
    "measureTest.create",
    "actionTest.create",
  ],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "string", description: "The entity under test, such as card:12", required: true },
  },
  inputSchema: TestBody,
  outputSchema: AnyTest,
  examples: [
    "mb test create --id card:12 --file test.json",
    "cat test.json | mb test create --id transform:5",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const entity = parseEntityRef(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    refuseForeignFields(entity, body);
    const client = await getClient();
    function createTest(): Promise<AnyTest> {
      const { parameters, now, ...fields } = body;
      const options = { signal: interruptSignal };
      switch (entity.type) {
        case "transform": {
          return client.transformTest.create({ ...fields, transform_id: entity.id }, options);
        }
        case "card": {
          return client.cardTest.create({ ...fields, now, card_id: entity.id }, options);
        }
        case "segment": {
          return client.segmentTest.create({ ...fields, now, segment_id: entity.id }, options);
        }
        case "measure": {
          return client.measureTest.create({ ...fields, now, measure_id: entity.id }, options);
        }
        case "action": {
          return client.actionTest.create(
            { ...fields, now, parameters: parameters ?? {}, action_id: entity.id },
            options,
          );
        }
      }
    }
    const created = await createTest();
    const ref = testRefText({ type: entity.type, id: created.id });
    renderSummary(created, anyTestView, `Created ${ref} "${created.name}".`, ctx);
  },
});
