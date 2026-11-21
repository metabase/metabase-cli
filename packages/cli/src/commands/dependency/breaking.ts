import { BreakingSourceCompact } from "@metabase/client/domain/dependency";
import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { breakingSourceView } from "../../output/views/dependency";
import { collectForOutput } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { itemFilterFlags, readItemFilters } from "./filter-flags";

export const DependencyBreakingListEnvelope = listEnvelopeSchema(BreakingSourceCompact);

const TRANSFORM_SOURCE_FEATURE = "dependencyTransformErrorSources" satisfies FeatureName;

export default defineMetabaseCommand({
  meta: {
    name: "breaking",
    description: "List the entities whose dependents carry query errors, across the whole instance",
  },
  details: `Each row is a source of breakage with its \`dependents_errors\`: the validation errors query analysis traced back to it, each with the dependent it was found in (\`analyzed_entity_type\`, \`analyzed_entity_id\`) and its \`error_type\` (\`missing-column\`, \`syntax-error\`, …). Lists cards and tables unless \`--types\` says otherwise; only a table, a card or, on a server with \`${TRANSFORM_SOURCE_FEATURE}\` (${featureAvailability(TRANSFORM_SOURCE_FEATURE)}), a transform can be a source. The server pages the answer: \`total\` is its count, and \`--limit\` and \`--offset\` size the request.`,
  requires: ["dependency.breakingPages"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...itemFilterFlags,
  },
  outputSchema: DependencyBreakingListEnvelope,
  examples: [
    "mb dependency breaking",
    "mb dependency breaking --types table --json",
    "mb dependency breaking --sort-column dependents-errors --sort-direction desc --json",
  ],
  async run({ args, ctx, getClient }) {
    const filters = readItemFilters(args);
    const client = await getClient();
    const envelope = await collectForOutput(
      (request) => client.dependency.breakingPages(filters, request),
      breakingSourceView,
      ctx,
    );
    renderList(envelope, breakingSourceView, ctx);
  },
});
