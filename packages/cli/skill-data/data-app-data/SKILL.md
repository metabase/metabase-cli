---
name: data-app-data
description: Give a Metabase data app its data — questions in the app's collection over the Library's published tables and metrics, the typed `src/metabase.ts` that `mb data-app typed-schema` generates, and the `useMetabaseQuery` and `useMetabaseQueryObject` hooks that run them, with runtime filter clauses, sorting and aggregation. Triggers — "show revenue by month in my data app", "list customers in the app", "add a KPI", "a chart of orders by category", "regenerate metabase.ts". Creating and publishing the app is `data-app`; filter controls are `data-app-filters`; writes are `data-app-actions`; chart choice and sizing are `data-app-ui`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Data in a data app

Before changing an existing app, pass the checks in `data-app`, _An existing project_: the template's config and factory, and React 19.

A data app runs only the questions and actions in **the app's collection** (`data-app`, _Create the app_); its viewers can read nothing else. So every piece of data starts there:

1. Create a question (below) or an action (`data-app-actions`) in the app's collection.
2. Regenerate `src/metabase.ts`, the typed list of everything in the collection.
3. Pass `queries.<name>` or `actions.<name>` from it to a hook.

## Sources: the semantic layer only

An app reads only what the user curated in the Library. Metabase refuses a question in the app's collection that breaks these rules:

- **Tables published to the Library**, and nothing else: `mb table list --published-only --json`. That covers the question's source table, every join, every table reached through a foreign key column, the tables behind its segments and measures, and the tables whose columns Metabase shows in place of a foreign key.
- **Metrics in the Library's Metrics collection**, as aggregations (its id is in `mb library get`; list it with `mb collection items <id> --json`), and the segments and measures of published tables (`mb segment list`, `mb measure list`). Prefer one that matches the concept over rebuilding it with filters and thresholds of your own.
- **No other question as a source** — not a question in the app's collection, a model or a metric. Every question starts from a published table.
- **MBQL only**, never native SQL.

When the app needs a table or metric the Library lacks, stop: name what's missing and ask the user to publish the table or move the metric into the Library. Don't publish it yourself unless the user says to, and never work around the gap with an unpublished table, a copy of the data, or SQL.

## Questions

Write each question's query in MBQL (the `mbql` skill), finding ids with `mb table list --published-only --term <name>` and `mb table get <id> --include fields --json`. Write the `dataset_query` object to `query.json`, dry-run it, then create the question in the app's collection:

```bash
mb query --dry-run --file query.json
mb card create --json --body '{
  "name": "Revenue by month",
  "type": "question",
  "display": "line",
  "collection_id": 42,
  "visualization_settings": {},
  "dataset_query": { … }
}'
mb card query <id> --json --max-bytes 0 | jq '{row_count, first: .data.rows[0]}'
```

Plan the questions from what the app shows and picks from — each chart, KPI, table and filter option list needs one, and several panels may share one. Each takes one of two shapes:

- **Aggregated**, when the breakdown is fixed: revenue by month, top products. Runtime clauses can then name only the columns it returns, its breakouts and aggregations.
- **Rows**, when a runtime filter targets a column an aggregation would drop — revenue by month, filtered by product category. The question returns the raw columns (`CREATED_AT`, `TOTAL`, `CATEGORY`), and the hook filters and aggregates them at runtime (_Runtime clauses_). When a Library metric or measure defines the number, never rebuild it from rows: filter an aggregated question instead (_Runtime clauses_).

Also:

- A question filtered at runtime has no `limit` of its own: it would apply before the filters. Put the limit in the hook. A question nothing filters, such as "the 20 latest reviews", keeps its sort and limit.
- The name becomes the key in `queries`, camelCased: `Revenue by month` → `queries.revenueByMonth`.
- `display` and `visualization_settings` show only in Metabase; the app picks its own chart type.
- Nothing in the app's collection is archived, public or embedded. To drop a question, move it out (`mb card update <id> --body '{"collection_id":<other>}'`), then archive it.

## `src/metabase.ts`

```bash
mb data-app typed-schema <slug> --out src/metabase.ts
```

Run it after **every** change to the app's collection, then `npm run typecheck`, which catches code still using a renamed or removed column. Never edit the file. It names every question and action by entity ID, so it works unchanged on every instance the app is synced to.

```ts
export const queries = {
  revenueByMonth: defineQuery({
    source: {
      type: "card",
      entityId: "…",
      name: "Revenue by month",
      columns: [
        { type: "column", name: "CREATED_AT", displayName: "Created At: Month", jsType: "Date", semanticType: "type/CreationTimestamp" },
        { type: "column", name: "sum", displayName: "Sum of Total", jsType: "number", semanticType: "type/Currency" },
      ],
    },
  }),
};
export const actions = { setOrderNote: defineAction({ action: { id: "…", parameters: [ … ] } }) };
```

A column's `name` keys the rows and names the column in runtime clauses. Take it from this file, never from SQL:

- A column reached through a foreign key keeps its own name (`CATEGORY`, not `PRODUCTS__via__PRODUCT_ID__CATEGORY`), and a named aggregation keeps its name.
- A foreign key that Metabase displays as a name returns that name as an extra column: `USER_ID` comes with a `NAME` column whose `displayName` is "User ID". Show `NAME`; filter by `USER_ID`.
- A `Date` column's values arrive as ISO strings.

## Rows: `useMetabaseQuery`

```tsx
import { useMetabaseQuery } from "@metabase/embedding-sdk-react/data-app";
import { queries } from "../metabase";

const { data, error, refetch } = useMetabaseQuery(queries.revenueByMonth);
const rows = data?.rows ?? []; // row.CREATED_AT, row.sum, typed from jsType
```

- Rows are objects keyed by column `name`. Never index them by position or cast them, and guard `null` values.
- `data` is `null` until the first answer, and stays `null` while the query is held back with `enabled: false` — show the before-a-choice state then. Otherwise `data === null && !error` is loading, and `data.rows.length === 0` is empty.
- `error` is `unknown`: render `error instanceof Error ? error.message : String(error)` in the panel.
- Call each hook once, in the highest component that needs the data, and pass the result down. Never call a hook in a loop or a condition.

## Charts: `useMetabaseQueryObject`

A chart, KPI or table Metabase can draw renders as an SDK question:

```tsx
import { StaticQuestion, type MetabaseCard } from "@metabase/embedding-sdk-react";
import { useMetabaseQueryObject } from "@metabase/embedding-sdk-react/data-app";
import { useMemo } from "react";

const { query, isLoading, error } = useMetabaseQueryObject(queries.revenueByMonth);
const card = useMemo(() => ({ query, visualization: "line" }) satisfies MetabaseCard, [query]);

// PanelError and Spinner are the app's own components
if (error) return <PanelError error={error} />;
if (isLoading || !query) return <Spinner />;
return <StaticQuestion card={card} height={360} />;
```

- Always pass `visualization`: the question's own `display` doesn't reach the app, and without one Metabase picks a default, often a table. Which chart, its settings and its size: `data-app-ui`.
- Build `card` with `useMemo` keyed on `query`: a new object re-runs the question.
- Render `error` wherever this hook is used: reading only `query` makes a failed question look like endless loading.

## Runtime clauses

Both hooks take a second argument: one object with the clauses the UI changes, and `enabled`. They run on top of the question and name its columns. Keep them in a `<Component>.query.ts` file next to the component, so its test mocks the same clauses (`data-app-testing`):

```tsx
import { aggregations, filter, orderBy } from "@metabase/embedding-sdk-react/data-app";

const [start, end] = range; // from DateRangePopover (data-app-filters)
const { query } = useMetabaseQueryObject(queries.orderRows, {
  filters:
    start && end ? [filter({ type: "column", name: "CREATED_AT" }, "between", [start, end])] : [],
  aggregations: [aggregations.sum({ type: "column", name: "TOTAL" }, { name: "revenue" })],
  breakouts: [{ type: "column", name: "CREATED_AT", unit: "month" }],
  orderBys: [orderBy({ type: "column", name: "CREATED_AT" }, "asc")],
});
```

- A column is `{ type: "column", name }` with a `name` from `src/metabase.ts`; a wrong name, or an operator its type doesn't take, fails to compile. A date breakout takes a `unit` (`day`, `week`, `month`, `quarter`, `year`).

  | Column type | Operators                                                                                                             |
  | ----------- | --------------------------------------------------------------------------------------------------------------------- |
  | string      | `=`, `!=`, `contains`, `does-not-contain`, `starts-with`, `ends-with`, `is-empty`, `not-empty`, `is-null`, `not-null` |
  | number      | `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `is-null`, `not-null`                                                     |
  | date        | `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `time-interval`, `is-null`, `not-null`                                    |
  | boolean     | `=`, `is-null`, `not-null`                                                                                            |

- `filter(...)` takes one value: `filter(col, "=", [a, b])` compiles but is not an IN filter, and several filters AND together. So a filter picks one value or All; for a multi-select, ask the user whether a single choice will do.
- Text operators are case-sensitive, with no option to change it: say so in the search box's placeholder.
- `time-interval` (`[-30, "day"]`, `[0, "year"]` for this year) is relative to when the query runs: a fixed window belongs in the question, not the hook.
- On a rows question, aggregate with any of `aggregations.count`, `sum`, `avg`, `median`, `min`, `max`, `distinct`, naming each result (`{ name: "revenue" }`) to order or read it by — two unnamed results of one operator collide, and generated names such as `sum_2` aren't stable. Never aggregate an aggregated question at runtime: a sum over its rows is wrong for distinct counts, averages, ratios and levels such as MRR. A runtime filter only picks its rows. So a date filter on it offers presets of whole, complete buckets at the question's own grain (Last month, Last 12 months on a month question), each range from the first bucket's start to the last bucket's start, and no Custom range; a KPI shows one bucket, as `scalar` (a `smartscalar` filtered to one bucket loses its comparison), with no All time. A filter on a column needs a question broken out by that column too; its All is no clause when the panel shows that column (a series per value), and otherwise a second question without that breakout, both hooks called and switched with `enabled`. When a request needs more, say so.
- A sort the user picks: map each choice to a column explicitly (`{ revenue: "revenue", orders: "order_count" }`) rather than passing the user's value through.
- `enabled: false` holds the query back, for example until the user picks an item.
- Write the arrays inline (spreads are fine): the hooks compare by content, so a new array per render doesn't refetch. A clauses object built outside the call needs `as const`, or `aggregations` loses the tuple type `breakouts` need; a shared `ReturnType<typeof filter>[]` built with `push` breaks the operator types the same way.

The controls that feed these clauses are `data-app-filters`. When the data is in place, build and publish (`data-app`, _Build and publish_).
