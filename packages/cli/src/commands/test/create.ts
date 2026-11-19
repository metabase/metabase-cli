import { renderSummary } from "../../output/render";
import { AnyTest } from "../../core/data-test";
import { testView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEntityRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";
import { refuseForeignFields, TestBody } from "./body";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data test from JSON" },
  details:
    "The body needs a `name`, the `inputs` standing in for every table the entity reads, and the `expectations` checked against its output. `now`, an ISO-8601 date-time with an offset such as 2026-10-13T00:00:00Z, fixes the moment a transform or card reads as the current time; `parameters` are the values an action test calls its action with.",
  requires: ["dataTest.create"],
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
    const created = await client.dataTest.create(entity.type, entity.id, body, {
      signal: interruptSignal,
    });
    const ref = testRefText({ type: entity.type, id: created.id });
    renderSummary(created, testView(entity.type), `Created ${ref} "${created.name}".`, ctx);
  },
});
