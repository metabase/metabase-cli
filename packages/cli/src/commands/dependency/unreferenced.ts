import { DependencyNodeCompact } from "@metabase/client/domain/dependency";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { dependencyNodeView } from "../../output/views/dependency";
import { collectForOutput } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { itemFilterFlags, readItemFilters } from "./filter-flags";

export const DependencyUnreferencedListEnvelope = listEnvelopeSchema(DependencyNodeCompact);

export default defineMetabaseCommand({
  meta: {
    name: "unreferenced",
    description:
      "List the entities no readable, unarchived content depends on, across the instance",
  },
  details:
    "Only a dependent the caller can read and that is not archived counts, so an entity used only by archived content, or by content in collections the caller cannot read, is listed. Every entity kind is listed unless `--types` narrows it; a `--query` leaves sandboxes out, since they have no name or location to match. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.",
  requires: ["dependency.unreferencedPages"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...itemFilterFlags,
  },
  outputSchema: DependencyUnreferencedListEnvelope,
  examples: [
    "mb dependency unreferenced",
    "mb dependency unreferenced --types card --card-types model,metric --json",
    "mb dependency unreferenced --query orders --sort-column location --json",
  ],
  async run({ args, ctx, getClient }) {
    const filters = readItemFilters(args);
    const client = await getClient();
    const envelope = await collectForOutput(
      (request) => client.dependency.unreferencedPages(filters, request),
      dependencyNodeView,
      ctx,
    );
    renderList(envelope, dependencyNodeView, ctx);
  },
});
