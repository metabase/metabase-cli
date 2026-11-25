import { DependencyEntityCompact } from "@metabase/client/domain/dependency";
import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

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

const TRANSFORM_SOURCE_FEATURE = "dependencyTransformErrorSources" satisfies FeatureName;

export default defineMetabaseCommand({
  meta: {
    name: "broken",
    description: "List the dependents whose queries an entity has broken",
  },
  details: `Lists the entities whose query analysis traced a validation error (a missing column, a syntax error) back to this entity, directly or through others. Only a table, a card or, on a server with \`${TRANSFORM_SOURCE_FEATURE}\` (${featureAvailability(TRANSFORM_SOURCE_FEATURE)}), a transform is traced as a cause, so any other \`<type>\` lists nothing. Rows carry no \`dependents_count\`. For the direct dependents whose analysis failed for any cause, use \`mb dependency dependents <type> <id> --broken\`.`,
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
