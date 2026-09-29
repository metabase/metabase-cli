import { DependencyGraph } from "@metabase/client/domain/dependency";

import { renderItem } from "../../output/render";
import { dependencyGraphView } from "../../output/views/dependency";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { entityArgs, parseDependencyType } from "./entity";

export default defineMetabaseCommand({
  meta: {
    name: "graph",
    description: "Show everything an entity depends on, directly or transitively",
  },
  details:
    "`nodes` holds the entity itself plus every table, card, snippet, transform or other entity it reads from, each with its `dependents_count` by kind; `edges` run from a dependent to what it depends on. Pass `--full` for the heavier hydrations on each node (a table's `fields`, a card's `result_metadata`).",
  requires: ["dependency.graph"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...entityArgs,
  },
  outputSchema: DependencyGraph,
  examples: [
    "mb dependency graph card 1",
    "mb dependency graph table 12 --json",
    "mb dependency graph transform 3 --fields edges",
  ],
  async run({ args, ctx, getClient }) {
    const type = parseDependencyType(args.type);
    const id = parseId(args.id);
    const client = await getClient();
    const graph = await client.dependency.graph(type, id);
    renderItem(graph, dependencyGraphView, ctx);
  },
});
