import { BreakingSourceCompact } from "@metabase/client/domain/dependency";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { breakingSourceView } from "../../output/views/dependency";
import { collectForOutput } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { itemFilterFlags, readItemFilters } from "./filter-flags";

export const DependencyBreakingListEnvelope = listEnvelopeSchema(BreakingSourceCompact);

export default defineMetabaseCommand({
  meta: {
    name: "breaking",
    description: "List the entities whose dependents carry query errors, across the whole instance",
  },
  details:
    "Each row is a source of breakage with `dependents_errors`, the validation errors query analysis traced back to it, each naming the dependent it was found in. Cards and tables are listed unless `--types` says otherwise; only a table, a card or a transform can be a source, so any other kind lists nothing. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.",
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
