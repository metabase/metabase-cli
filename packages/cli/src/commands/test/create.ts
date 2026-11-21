import { renderSummary } from "../../output/render";
import { AnyTest } from "../../core/data-test";
import { anyTestView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEntityRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";
import { refuseForeignFields, TestBody } from "./body";
import { printable } from "../../output/table";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data test from JSON" },
  details:
    "The body needs a `name`, the `inputs` standing in for every table the entity reads, and the `expectations` checked against its output. `now` fixes the time the entity reads as the current time; `parameters`, an action test's alone, are the values it calls its action with. The entity comes from --id, so the body names no `<type>_id`.",
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
    renderSummary(created, anyTestView, `Created ${ref} "${printable(created.name)}".`, ctx);
  },
});
