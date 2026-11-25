import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

import { defineCommandGroup } from "../group";

const ASYNC_BACKFILL_FEATURE = "dependencyAsyncBackfill" satisfies FeatureName;
const ARCHIVED_SOURCES_FEATURE = "dependencyKeepsArchivedSources" satisfies FeatureName;

export default defineCommandGroup({
  name: "dependency",
  description: "Trace what Metabase content depends on and what depends on it",
  details: [
    `Metabase records an edge from each card, dashboard, document, snippet, transform, sandbox, segment, measure or action to what it reads (a table, a card, a snippet, a transform's output), and analyzes each dependent's query for errors it traces back to what it reads. With \`${ASYNC_BACKFILL_FEATURE}\` (${featureAvailability(ASYNC_BACKFILL_FEATURE)}), a background job recomputes the graph shortly after content changes, so a just-saved query can take a few seconds to appear.`,
    "## What each row holds",
    "Every row is `{ id, type, data }`, plus `dependents_count` where the command reports it: a map from usage kind (`question`, `model`, `metric`, `dashboard`, `document`, `transform`, …) to how many entities depend directly on the row, or `null` when nothing does. `data` names and places the entity: every kind but a sandbox has a `name`, and each kind also carries:",
    "| Entity | `data` carries |\n| --- | --- |\n| Table | `display_name`, `db_id`, `schema` and `db` (`{ id, name }`) |\n| Card | `type` (`question`, `model` or `metric`), `database_id`, `view_count`, `collection`, and the `dashboard` or `document` it lives in, if any |\n| Dashboard, document | `view_count` and `collection` |\n| Snippet | `collection` |\n| Action | `type` (`query` or `implicit`) and `collection` |\n| Segment, measure, sandbox | `table` (`{ id, name, display_name }`) |\n| Transform | `description`, with `table` always `null` |",
    "`--full` adds the heavier fields: a table's `fields`, a card's `result_metadata`, creators and last-edit info.",
    "## An entity's location",
    "An entity's location is the dashboard, document or collection that holds a card, a table's database, a segment's or measure's table, or the collection of a snippet, dashboard, document or action. `--query` matches it as well as the name, `--sort-column location` sorts by it, and the text table shows it. A sandbox has none, so `unreferenced` and `breaking` sort it by id.",
    "A transform's row carries no collection. `unreferenced` and `breaking` match and sort it by its collection's name (`Transforms` at the root); `dependents`, `broken` and the text table give it no location.",
    "## Archived and dropped content",
    `With \`${ARCHIVED_SOURCES_FEATURE}\` (${featureAvailability(ARCHIVED_SOURCES_FEATURE)}), \`graph\` includes archived upstream entities; older servers leave them out. On every server, \`dependents\`, \`broken\` and \`unreferenced\` leave out archived cards, dashboards, documents, snippets, actions, segments and measures.`,
    "The same servers keep dropped and hidden tables in `unreferenced` and `breaking`, and archived sources in `breaking`, so they report a dropped table or an archived card that broke its dependents. Older servers leave these out, and the CLI has no flag to bring them back.",
  ].join("\n\n"),
  subCommands: {
    graph: () => import("./graph").then((m) => m.default),
    dependents: () => import("./dependents").then((m) => m.default),
    broken: () => import("./broken").then((m) => m.default),
    unreferenced: () => import("./unreferenced").then((m) => m.default),
    breaking: () => import("./breaking").then((m) => m.default),
  },
});
