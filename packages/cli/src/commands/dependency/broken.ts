import { DependencyEntityCompact } from "@metabase/client/domain/dependency";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { dependencyEntityView } from "../../output/views/dependency";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { entityArgs, parseDependencyType } from "./entity";
import { dependentFilterFlags, readDependentFilters } from "./filter-flags";

export const DependencyBrokenListEnvelope = listEnvelopeSchema(DependencyEntityCompact);

export default defineMetabaseCommand({
  meta: {
    name: "broken",
    description: "List the dependents whose queries an entity has broken",
  },
  details:
    "An entity is listed when Metabase's query analysis traced a validation error in it (a missing column, a syntax error) back to this entity, whether it reads the entity directly or through others. Only a table, a card or a transform is ever traced as the cause, so any other `<type>` lists nothing. Rows carry no `dependents_count`. `mb dependency dependents <type> <id> --broken` answers a different set: the direct dependents whose analysis failed for any cause.",
  requires: ["dependency.broken"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...entityArgs,
    ...dependentFilterFlags,
  },
  outputSchema: DependencyBrokenListEnvelope,
  examples: [
    "mb dependency broken table 12",
    "mb dependency broken card 1 --dependent-types card --json",
  ],
  async run({ args, ctx, getClient }) {
    const type = parseDependencyType(args.type);
    const id = parseId(args.id);
    const filters = readDependentFilters(args);
    const client = await getClient();
    const { data } = await client.dependency.broken(type, id, filters);
    renderList(windowList(data, ctx.range), dependencyEntityView, ctx);
  },
});
