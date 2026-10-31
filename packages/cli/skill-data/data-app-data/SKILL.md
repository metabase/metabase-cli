---
name: data-app-data
description: Give a Metabase data app its data — `src/metabase.schema.ts` from `mb data-app generate-schema`, questions over the Library's published tables and metrics as `defineQuery` exports in `src/metabase.queries.ts`, their entity IDs from `mb nano-id`, and the `useMetabaseQuery` and `useMetabaseQueryObject` hooks that run them, with runtime filter clauses, sorting and aggregation. Triggers — "show revenue by month in my data app", "list customers in the app", "add a KPI", "a chart of orders by category", "regenerate the schema". Creating and releasing the app is `data-app`; filter controls are `data-app-filters`; writes are `data-app-actions`; chart choice and sizing are `data-app-ui`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Data in a data app

Before changing an existing app, pass the checks in `data-app`, _An existing project_: the template's config and factory, and React 19.

A data app runs only the questions and actions it defines; its viewers can read nothing else. So every piece of data starts in its source:

1. Fetch `src/metabase.schema.ts` (below).
2. Define a question in `src/metabase.queries.ts` (below) or an action in `src/metabase.actions.ts` (`data-app-actions`).
3. Pass the export to a hook. The dev preview runs it at once; Metabase runs it once the app is released (`data-app`, _Release_).

## Sources: the semantic layer only

An app reads only what the user curated in the Library, and `src/metabase.schema.ts` holds exactly that. Metabase refuses a question that breaks these rules:

- **Tables published to the Library**, and nothing else: the source table, every table reached through a foreign key column, and the tables behind its segments and measures.
- **Metrics in the Library**, as aggregations, and the segments and measures of published tables. Prefer one that matches the concept over rebuilding it with filters and thresholds of your own.
- **No other question as a source** — not one of the app's own, a model or a metric. Every question starts from a published table.
- **One stage of MBQL**, never native SQL, with no explicit joins and no custom columns: reach another table through a foreign key column, and compute in the app.

When the app needs a table or metric the Library lacks, stop: name what's missing and ask the user to publish the table or move the metric into the Library. Don't publish it yourself unless the user says to, and never work around the gap with an unpublished table, a copy of the data, or SQL.

## `src/metabase.schema.ts`

```bash
cd <repo> && mb data-app generate-schema <slug> --profile <name>
```

From the repository root, this writes `data_apps/<slug>/src/metabase.schema.ts`: the Library's published tables with their fields, segments and measures, and the Library's metrics, each keyed by its camelCased name, with its numeric ID. It exports `schema` (`import { schema } from "./metabase.schema"`). Fetch it again after the user publishes a table or changes its metadata, then `npm run typecheck`, which catches code still using a renamed or removed field. Never edit the file.

The numeric IDs are that instance's, so the dev preview runs against it alone; a production build runs each question by its `entityId` instead, on every instance the app is imported to.

## Questions

`src/metabase.queries.ts` holds one export per question:

```ts
import {
  aggregations,
  breakout,
  defineQuery,
  orderBy,
} from "@metabase/embedding-sdk-react/data-app";

import { schema } from "./metabase.schema";

const orders = schema.tables.orders;

export const revenueByMonth = defineQuery({
  entityId: "Vh3kq0wYc8TnS2aJm1LxR",
  source: orders,
  aggregations: [aggregations.sum(orders.fields.total, { name: "revenue" })],
  breakouts: [breakout(orders.fields.createdAt, { unit: "month" })],
});

export const latestReviews = defineQuery({
  entityId: "pW9dE4uNq7Zb1fGhK3sTy",
  source: schema.tables.reviews,
  orderBys: [orderBy(schema.tables.reviews.fields.createdAt, "desc")],
  limit: 20,
});
```

- `source` is a table of `schema`; `aggregations`, `breakouts`, `filters`, `orderBys`, `limit` and `fields` (the columns to keep) take its fields, its segments and measures, and the metrics of `schema.metrics` as aggregations (`aggregations: [schema.metrics.revenue]`). A field that isn't the table's, or an operator its type doesn't take, fails to compile.
- The export's name is the question's name in Metabase, as written (`customerList`).
- Each `entityId` comes from `mb nano-id` (`mb nano-id --count <n>` for several), never invented or copied. Keep an export's `entityId` when you edit it: a new one replaces the question with another.

Plan the questions from what the app shows and picks from — each chart, KPI, table and filter option list needs one, and several panels may share one. Each takes one of two shapes:

- **Aggregated**, when the breakdown is fixed: revenue by month, top products. Runtime clauses can then name only the columns it returns, its breakouts and aggregations.
- **Rows**, when a runtime filter targets a column an aggregation would drop — revenue by month, filtered by product category. The question returns the raw columns (`CREATED_AT`, `TOTAL`, `CATEGORY`), and the hook filters and aggregates them at runtime (_Runtime clauses_). When a Library metric or measure defines the number, never rebuild it from rows: filter an aggregated question instead (_Runtime clauses_).

Also:

- A question filtered at runtime has no `limit` of its own: it would apply before the filters. Put the limit in the hook. A question nothing filters, such as "the 20 latest reviews", keeps its sort and limit.
- To drop a question, delete its export.

A result column's `name` keys the rows and names the column in runtime clauses: a field's `name` in `src/metabase.schema.ts`, in the database's own case (`CREATED_AT` here, `created_at` on Postgres), or an aggregation's — `count`, `sum`, or the `name` you gave it. Never take one from SQL:

- A column reached through a foreign key keeps its own name (`CATEGORY`, not `PRODUCTS__via__PRODUCT_ID__CATEGORY`).
- A foreign key that Metabase displays as a name returns that name as an extra column: `USER_ID` comes with a `NAME` column whose `displayName` is "User ID". Show `NAME`; filter by `USER_ID`.
- A `Date` column's values arrive as ISO strings.

## Rows: `useMetabaseQuery`

```tsx
import { useMetabaseQuery } from "@metabase/embedding-sdk-react/data-app";
import { revenueByMonth } from "../metabase.queries";

const { data, error, refetch } = useMetabaseQuery(revenueByMonth);
const rows = data?.rows ?? []; // row.CREATED_AT, row.revenue, typed from jsType
```

- Rows are objects keyed by column `name`. Never index them by position or cast them, and guard `null` values.
- `data` is `null` until the first answer, and stays `null` while the query is held back with `enabled: false` — show the before-a-choice state then. Otherwise `isLoading` is true while a run is in flight (it stays false while held back), and `data.rows.length === 0` is empty.
- `error` is `unknown`. A refused or failed query sets it to the response, `{ status, data }`, whose `data` is the server's message or an object with a `message`; anything else is an `Error`. Read it with one helper, which narrows without a cast, and render its message in the panel as it comes:

```ts
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const { data } = error;
    if (typeof data === "string") {
      return data;
    }
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
```

- Call each hook once, in the highest component that needs the data, and pass the result down. Never call a hook in a loop or a condition.

## Charts: `useMetabaseQueryObject`

A chart, KPI or table Metabase can draw renders as an SDK question:

```tsx
import { StaticQuestion, type MetabaseCard } from "@metabase/embedding-sdk-react";
import { useMetabaseQueryObject } from "@metabase/embedding-sdk-react/data-app";
import { useMemo } from "react";

const { query, isLoading, error } = useMetabaseQueryObject(revenueByMonth);
const card = useMemo(() => ({ query, visualization: "line" }) satisfies MetabaseCard, [query]);

// PanelError and Spinner are the app's own components
if (error) return <PanelError error={error} />;
if (isLoading || !query) return <Spinner />;
return <StaticQuestion card={card} height={360} />;
```

- Always pass `visualization`: without one Metabase picks a default, often a table. Which chart, its settings and its size: `data-app-ui`.
- Build `card` with `useMemo` keyed on `query`: a new object re-runs the question.
- Render `error` wherever this hook is used: reading only `query` makes a failed question look like endless loading.

## Runtime clauses

Both hooks take a second argument: one object with the clauses the UI changes, and `enabled`. They run on top of the question and name its columns:

```tsx
import { aggregations, filter, orderBy } from "@metabase/embedding-sdk-react/data-app";

const [start, end] = range; // from DateRangePopover (data-app-filters)
const { query } = useMetabaseQueryObject(orderRows, {
  filters:
    start && end ? [filter({ type: "column", name: "CREATED_AT" }, "between", [start, end])] : [],
  aggregations: [aggregations.sum({ type: "column", name: "TOTAL" }, { name: "revenue" })],
  breakouts: [{ type: "column", name: "CREATED_AT", unit: "month" }],
  orderBys: [orderBy({ type: "column", name: "CREATED_AT" }, "asc")],
});
```

- A column is `{ type: "column", name }` with a result column's `name`, or a field of `schema`; a wrong name, or an operator its type doesn't take, fails to compile. A date breakout takes a `unit` (`day`, `week`, `month`, `quarter`, `year`).

  | Column type | Operators                                                                                                             |
  | ----------- | --------------------------------------------------------------------------------------------------------------------- |
  | string      | `=`, `!=`, `contains`, `does-not-contain`, `starts-with`, `ends-with`, `is-empty`, `not-empty`, `is-null`, `not-null` |
  | number      | `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `is-null`, `not-null`                                                     |
  | date        | `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `time-interval`, `is-null`, `not-null`                                    |
  | boolean     | `=`, `is-null`, `not-null`                                                                                            |

- `filter(...)` takes one value (`filter(col, "=", 42)`): `filter(col, "=", [a, b])` compiles but is not an IN filter, and several filters AND together. So a filter picks one value or All; for a multi-select, ask the user whether a single choice will do.
- Text operators are case-sensitive, with no option to change it: say so in the search box's placeholder.
- `time-interval` (`[-30, "day"]`, `[0, "year"]` for this year) is relative to when the query runs: a fixed window belongs in the definition, not the hook.
- On a rows question, aggregate with any of `aggregations.count`, `sum`, `avg`, `median`, `min`, `max`, `distinct`, naming each result (`{ name: "revenue" }`) to order or read it by — two unnamed results of one operator collide, and generated names such as `sum_2` aren't stable. Never aggregate an aggregated question at runtime: a sum over its rows is wrong for distinct counts, averages, ratios and levels such as MRR. A runtime filter only picks its rows. So a date filter on it offers presets of whole, complete buckets at the question's own grain (Last month, Last 12 months on a month question), each range from the first bucket's start to the last bucket's start, and no Custom range; a KPI shows one bucket, as `scalar` (a `smartscalar` filtered to one bucket loses its comparison), with no All time. A filter on a column needs a question broken out by that column too; its All is no clause when the panel shows that column (a series per value), and otherwise a second question without that breakout, both hooks called and switched with `enabled`. When a request needs more, say so.
- A sort the user picks: map each choice to a column explicitly (`{ revenue: "revenue", orders: "order_count" }`) rather than passing the user's value through.
- `enabled: false` holds the query back, for example until the user picks an item.
- Write the arrays inline (spreads are fine): the hooks compare by content, so a new array per render doesn't refetch. A clauses object built outside the call needs `as const`, or `aggregations` loses the tuple type `breakouts` need; a shared `ReturnType<typeof filter>[]` built with `push` breaks the operator types the same way.

The controls that feed these clauses are `data-app-filters`. When the data is in place, release the app (`data-app`, _Release_).
