import { DependencyNodeCompact } from "@metabase/client/domain/dependency";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { dependencyNodeView } from "../../output/views/dependency";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseOptionalText } from "../parse-text";
import { defineMetabaseCommand } from "../runtime";

import { entityArgs, parseDependencyType } from "./entity";
import { dependentFilterFlags, queryFlag, readDependentFilters } from "./filter-flags";

export const DependencyDependentsListEnvelope = listEnvelopeSchema(DependencyNodeCompact);

export default defineMetabaseCommand({
  meta: {
    name: "dependents",
    description: "List the entities that depend directly on an entity",
  },
  details:
    "Each row is a dependent with its own `dependents_count` by kind, so a chain can be followed one hop at a time. `--broken` keeps only the dependents whose query analysis failed, whatever the cause, and each row's `dependents_count` then counts only its broken dependents. The server sorts and filters; the window is applied here.",
  requires: ["dependency.dependents"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...entityArgs,
    ...dependentFilterFlags,
    ...queryFlag,
    broken: {
      type: "boolean",
      description: "Only the dependents whose query analysis failed, whatever the cause",
    },
  },
  outputSchema: DependencyDependentsListEnvelope,
  examples: [
    "mb dependency dependents table 12",
    "mb dependency dependents card 1 --dependent-types card,dashboard --json",
    "mb dependency dependents table 12 --broken --json",
    "mb dependency dependents card 1 --sort-column view-count --sort-direction desc",
  ],
  async run({ args, ctx, getClient }) {
    const type = parseDependencyType(args.type);
    const id = parseId(args.id);
    const filters = readDependentFilters(args);
    const client = await getClient();
    const { data } = await client.dependency.dependents(type, id, {
      ...filters,
      broken: args.broken ? true : undefined,
      query: parseOptionalText(args.query, "--query"),
    });
    renderList(windowList(data, ctx.range), dependencyNodeView, ctx);
  },
});
