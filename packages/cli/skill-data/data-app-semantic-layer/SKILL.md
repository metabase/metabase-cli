---
name: data-app-semantic-layer
description: Query Metabase tables and metrics from a data app through the generated schema (src/metabase.data.ts) — generating it with `mb data-app schema`, defineQuery definitions, filters, breakouts and rendering results.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Metabase Data App Semantic Layer

## Core Rules

Keep the semantic layer and presentation layer separate.

- All Metabase context must come from the generated schema file, usually `src/metabase.data.ts` or `src/*.metabase.data.ts`.
- Do not discover data through MCP tools, create Metabase content, create tables, or edit the semantic layer while building the React UI.
- Import data app query helpers from `@metabase/embedding-sdk-react/data-app`.
- Every query is a `defineQuery(...)` named export in the root-level `queries/` directory, and every action a `defineAction(...)` named export in the root-level `actions/` directory, both beside `package.json`. Create both directories before writing the first hook call; the template ships them, each with a README. The hooks enforce this at compile time: `useMetabaseQuery`, `useMetabaseQueryObject`, and `useAction` reject an inline object, a `satisfies MetabaseQueryOptions` object, and a spread copy of a definition. The error reads `Property 'definedWithDefineQuery' is missing` (or `'definedWithDefineAction'`); the fix is always to move the object into `queries/` or `actions/` as a definition and import it, never a cast.
- Never remove, edit, or copy a generated `savedQuestionSourceId` or `copiedActionId`, even if it appears unused. Preserve it during refactors; use `npm run sync-resources` to repair or replace generated IDs.
- Prefer generated schema objects over raw IDs or strings. Extract local constants for top-level table objects.
- Never hand-write `DatasetQuery`/MBQL objects in app code. Do not pass inline query objects like `{ type: "query", query: { "source-table": table.id } }`, raw `source-table` clauses, raw field IDs, bare table IDs, or metric IDs to SDK components, `useMetabaseQuery`, or `useMetabaseQueryObject`. Prefer generated table and metric schema objects; for simple table-source queries, an explicit source reference like `{ type: "table", id: table.id }` is also valid.
- Build queries with `source: schema.tables.<name>`, generated `fields`, generated `segments`, generated `measures`, generated metrics in `aggregations`, generated metric `dimensions`, `filter(...)`, `breakout(...)`, `orderBy(...)`, and `aggregations` helpers such as `aggregations.count()` and `aggregations.sum(...)`. Do not use `source: schema.metrics.<name>`; metrics are aggregation expressions, not query sources.
- Do not use existing saved questions as `useMetabaseQuery` or `useMetabaseQueryObject` sources. Typed schemas do not expose `schema.questions` or support `question-collections` while data-app reconciliation cannot copy existing saved questions into the app collection.
- Prefer semantically rich table queries over shallow table dumps. Use curated table measures, segments, filters, and breakouts when they make the generated app more useful.
- Prefer semantic-layer definitions over React-side inference. If the schema has a segment or measure for a concept, use it instead of recreating the concept from raw rows. Both belong to the static query only — the dynamic second argument cannot take them, see _Static and dynamic query parts_.
- Filter UI must default to showing data. Empty controls, "All" options, and incomplete custom ranges should produce no filter instead of blocking queries or showing a blank dashboard.
- Do not hardcode categorical filter option values. A generated schema field only proves the field exists, not which values exist; query options from Metabase at runtime using the same generated schema field that the filter applies.
- Dashboard-level filters should visibly affect every compatible card, table, KPI, and trend. If a filter can only apply to one query, make that scope obvious in the UI; do not show duplicate or no-op date controls.
- Entity filters, where the stored value is an id/key and the UI shows a label, must use a single searchable combobox. Click/focus must open the option list immediately, before typing. Query options at runtime, search labels, and store the raw value. Never render entity filters as `<select>`; plain selects are only for short closed enums explicitly provided by the user.
- Use `DateRangePopover` from `@metabase/embedding-sdk-react/data-app` for custom date ranges: it wraps the app's own trigger element and opens a Metabase-styled range calendar under it. The trigger stays the app's — style it like the other filter controls — and `useDateFormatter()` from the same entry produces its label. It ships with the SDK and needs no dependency and no CSS import. `DateRangeCalendar` is the same calendar inline, for when the app already has a container. Do not install a date picker library for a range — not `react-datepicker`, `react-day-picker`, `flatpickr`, or a UI suite's picker (`@mui/x-date-pickers`, `antd`, `rsuite`, …). Do not use native `<input type="date">` either: its placeholder and calendar popover are browser-controlled, often show `mm/dd/yyyy`, and cannot be reliably themed.
- Never build a date label with `new Date("YYYY-MM-DD")` — a date-only string parses as UTC and shows the previous day west of Greenwich. Use `formatDateRange` / `formatDate` from `useDateFormatter()`, which parse in local time and format in the instance's locale.
- Reach for a third-party date picker only for what the SDK calendar does not cover, such as single-date or date-time selection; `react-datepicker` is the default pick. Then import its stylesheet (`react-datepicker/dist/react-datepicker.css`), add small CSS overrides for the app's visual style if needed, and pass `Date | null` — never `new Date("")` or another invalid date for incomplete ranges; type strict callback parameters explicitly, such as `onChange={(date: Date | null) => ...}`.
- Date bars must include Custom last by default: duration presets, All time, then Custom. Omit Custom only when the user explicitly asks for fixed presets only or no date range control.
- Never invent aggregation or measure objects such as `{ name: "count" }` or `{ name: "sum", field: ... }`. Use generated table measures or exported aggregation helpers.
- Only render values returned by Metabase or deterministic transforms of returned values. Do not invent KPI values, trends, labels, statuses, ratings, timestamps, rankings, insights, segments, or chart series.
- Do not custom-render ambiguous business fields such as `margin`, `rate`, `score`, `percent`, `health`, `risk`, or `efficiency`. Do not add `%`, multiply by 100, color-code, or render stars unless semantic-layer units explicitly support it; use an SDK table/chart, omit the field, or ask for curation.
- Visualization data must come from Metabase through `useMetabaseQuery` or `useMetabaseQueryObject` with `InteractiveQuestion`/`StaticQuestion`. Do not hardcode chart-ready arrays, sample data, demo values, or schema-shaped mock values.
- Render charts with `InteractiveQuestion`/`StaticQuestion`. When a custom visualization is allowed instead, and which of the two to use, is decided by _Rendering a chart: Metabase first_ in the `data-app` skill's `references/sdk-surface.md`.
- `useMetabaseQueryObject(...)` returns `{ query, error, isLoading }`. Pass only the `query` property as `card={{ query }}` to `InteractiveQuestion` or `StaticQuestion`; never pass the whole hook result as `card.query`.
- `useMetabaseQuery().rows` are keyed objects, not tuple arrays. Never read `row[0]` / `row[1]`, and never silence this with `as unknown as [string, number][]`, `DisplayRow`, or another tuple cast. If TypeScript says property `0` does not exist, it is catching a real bug. For typed `data.rows`, use literal keys such as `row.count` or generated field names such as `row[ordersTable.fields.createdAt.name]`. Use `data.columns` with `rawRows` or after explicitly narrowing a key; do not index typed rows with arbitrary `string` values from `data.columns`.
- Do not cast query objects to `Parameters<typeof useMetabaseQuery>[0]` or to `DefinedQuery`. That erases the generated table/metric validation and the definition contract. Validate table ownership at the definition with `defineQuery<typeof table>(...)`; the hooks take the export with no generics.
- Do not build shared filter arrays with `ReturnType<typeof filter>[]` or `push(...)`; this can collapse overload inference. Pass raw filter state between components and build each query's `filters: [...]` inline with spreads.
- Keep runtime state out of the base query in `queries/`. A clause whose value comes from a control — a selected plan, a date range, a search box — belongs in the second argument to `useMetabaseQuery`/`useMetabaseQueryObject`, not in the query. See "Static and dynamic query parts".
- Do not include `fields` in queries with `aggregations` and `breakouts`; breakouts determine grouped result columns. Use `fields` only for row-selection queries.
- Before rendering a field, verify it exists in the generated schema object and is returned by the query. Do not guess table keys, field keys, or column names from the Metabase API, business intuition, or old mock data; only use entries actually emitted in `src/metabase.data.ts`.
- Avoid unsupported freshness or operational claims such as "real-time", "live", "understaffed", or "risk" unless the returned data or curated semantic-layer definition supports them.
- Before claiming the work is done or preparing a final handoff, run a TypeScript type-only check and report the command/result. If the check fails, fix the type errors before any final summary.

## Generate Schema

If `src/metabase.data.ts` already exists, use it. If it is missing or stale, treat generating it as semantic-layer curation for this app, not a mechanical export.

Choose the scope first:

1. Honor an explicit scope. Otherwise infer what the app needs: tables, curated metrics, or actions. "Show orders" needs tables; counts and sums can come from table aggregations.
2. Choose the narrowest scope that covers those needs, using collection and database ids or names from the request or the project.
3. Ask only for what selects a scope, such as which database. Once it is settled, state it briefly and generate without waiting.

```bash
mb data-app schema <scope flags> > src/metabase.data.ts
```

| Flag                          | Scope                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| `--include-data-library`      | the whole Library / Data tree                                              |
| `--include-metric-library`    | the whole Library / Metrics tree                                           |
| `--library-collections <ids>` | specific Data or Metrics library subcollections (ids or entity ids)        |
| `--database <id-or-name>`     | one database's tables; cannot be combined with the library flags           |
| `--include-models`            | readable models that have actions; with `--database`, that database's only |

Combine the library flags when the app needs both tables and metrics. Add `--include-models` for any mutation-like flow — creating, updating, deleting, submitting, approving, running a write — because actions are discoverable only as `schema.models.<model>.actions`, even when the user names one action. `mb` authenticates with its own profile, so no credentials are handled here.

After generating, check the schema holds every entity the app needs. If one is missing, widen the scope or ask for the missing context before building the UI.

If generation fails on a model or model action, surface the error as it is — the failing card or model ids and names, dropped action ids, and the message — rather than retrying past it.

## Synchronize every query and action

Everything an end-to-end prototype runs is permission-bound: it runs against a copy in the app's own collection; read access to that collection lets viewers run the app's cards, but they see the data only if they already have access to the underlying tables — the app grants the collection, not the tables. Declare each one as a named export in a root-level directory beside `package.json` — `queries/` for `defineQuery(...)`, `actions/` for `defineAction(...)`. `npm run sync-resources` scans only those two directories, so a definition under `src/queries/`, `src/actions/`, or any other source directory is silently never synchronized. Discovery covers `.js`, `.jsx`, `.ts`, `.tsx`, `.cjs`, `.cts`, `.mjs`, and `.mts`.

```ts
import { defineAction, defineQuery } from "@metabase/embedding-sdk-react/data-app";
import schema from "../src/metabase.data";

// queries/revenue.query.ts
export const RevenueQuery = defineQuery({ source: schema.tables.orders });

// actions/orders.action.ts
export const CreateOrder = defineAction({
  action: schema.models.orders.actions.create,
});
```

One `sync-resources` run reconciles both. For a query it materializes the authored table query as a saved question and injects `savedQuestionSourceId`. For an action it copies the action's parent model into the app collection, copies the action onto that copy, and injects `copiedActionId`; a model is copied once no matter how many of its actions the app declares, siblings reuse that copy, and it disappears with the last declaration. Never copy a model into the app collection by hand.

Pass the definition itself to the hook and let the SDK resolve what runs — a production build runs the copy, while the dev preview runs the authored table or action, so an app works before its first synchronization:

```ts
const { data } = useMetabaseQuery(RevenueQuery, {
  filters: [filter(RevenueQuery.source.fields.status, "=", selectedStatus)],
});

const { execute, isExecuting, error } = useAction(CreateOrder);
```

Never pass an inline table-source query (not even a read-only, filter-option, or helper query), a raw action id, `savedQuestionSourceId`, `copiedActionId`, or a hand-built `{ source: { type: "card", id } }`, and never spread a definition into a new object. Each defeats the swap; the authored ids also bypass the permission boundary. TypeScript rejects most of these: the hooks accept only what `defineQuery`/`defineAction` returned, so an inline object, a `satisfies`-typed object, a spread copy, and `schema.models.<model>.actions.<action>` all fail to compile. When `tsc` reports `Property 'definedWithDefineQuery' is missing` or `Property 'definedWithDefineAction' is missing`, the argument is not a definition: move it into `queries/` or `actions/` and import the export. Do not silence it with a cast or by wrapping the inline object in `defineQuery(...)` at the call site, which compiles but leaves the query unsynchronized. Keep fixed permission-boundary filters, aggregations, and breakouts inside `defineQuery` — synchronization bakes them into the saved question, so don't apply them again outside it, and put runtime clauses in the hook's second argument (see _Static and dynamic query parts_). `useAction` needs no generics: the definition types `execute`'s parameters and `result`.

Wire `package.json` with `"sync-resources": "embedding-sdk-react data-apps sync-resources"` and `"build": "npm run sync-resources && vite build"`, then run `npm run build` after adding, changing, renaming, or removing any definition; run `sync-resources` directly only to inspect generated state before a build. It reads `DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` from the repo-root `.env.local`.

Inline generated IDs and `resources_metadata.json` are generated state: never delete or hand-edit either. A missing ID is restored automatically when the definition still identifies its resource — a query by its table and authored hash matching one unclaimed lockfile entry, an action by naming the same action — while a duplicated ID fails the run. Do not test or hand off the app until `npm run build` succeeds, every live definition carries a positive generated ID, and `resources_metadata.json` holds its matching entry. Commit every generated change. The build stops before bundling when synchronization fails.

If synchronization fails, surface the exact error and stop. Fix local shape, serialization, duplicate-ID, or lockfile errors before retrying. A confirmed `404` is recovered automatically; authentication, permission, network, server, collection-ownership, and Card-type failures must not trigger manual Card creation, deletion, ID replacement, or lockfile editing. Treat a successful run that discovers nothing as a failure when the app has queries or actions. Synchronization copies actions but never creates them, so an action the app needs must already exist in Metabase and be picked up by a regenerated schema; if the run reports that actions are not enabled for the database, stop and tell the user to enable them rather than working around it.

## Standard pattern

Two files per query: the definition in `queries/`, the hook call in the component.

```ts
// queries/orders.query.ts
import {
  aggregations,
  breakout,
  defineQuery,
  filter,
  orderBy,
} from "@metabase/embedding-sdk-react/data-app";
import schema from "../src/metabase.data";

const ordersTable = schema.tables.orders;

export const PaidRevenueByMonth = defineQuery({
  source: ordersTable,
  filters: [ordersTable.segments.completed, filter(ordersTable.fields.status, "=", "paid")],
  aggregations: [aggregations.sum(ordersTable.fields.amount)],
  breakouts: [breakout(ordersTable.fields.createdAt, { unit: "month" })],
  orderBys: [orderBy(ordersTable.fields.createdAt, "desc", { unit: "month" })],
  limit: 100,
});
```

```tsx
// src/pages/Overview.tsx
import { useMetabaseQuery } from "@metabase/embedding-sdk-react/data-app";
import { PaidRevenueByMonth } from "../../queries/orders.query";

const { data, isLoading, error } = useMetabaseQuery(PaidRevenueByMonth);
```

`useMetabaseQuery(...)` infers typed row data from the definition, so write no generics on the hook. To check table ownership of fields, segments, and measures, put the generic on the definition: `defineQuery<typeof ordersTable>({ ... })`. Leave it off selected-field queries when you need precise row keys from `data.rows`. The recipes below show the object passed to `defineQuery`; each one is an export in `queries/`, never an argument written at the hook.

**Call each schema entry at most once per render tree.** Multiple `useMetabaseQuery` calls on the same `questionId` (or same `tableId` + identical filters/measures/breakouts) mount independent subscriptions, fire duplicate queries, and let consumers disagree mid-load. Lift the call to the highest component that needs the data; pass `data` / `isLoading` / `error` down as props. Different ids — or the same id with different filters / breakouts — are different data sources; call them separately.

Use keyed schema objects:

- Tables: `source: schema.tables.<table>`
- metrics: `schema.metrics.<metric>` inside `aggregations`
- Fields: `schema.tables.<table>.fields.<field>`
- Segments: `schema.tables.<table>.segments.<segment>`
- Measures: `schema.tables.<table>.measures.<measure>`
- metric dimensions: `schema.metrics.<metric>.dimensions.<group>.<dimension>`

Do not pass raw dimension strings like `"created_at"` or `"segment"`.

## Static and dynamic query parts

Both query hooks take an optional second argument: the clauses that change while the app runs.

```ts
// revenue.query.ts — static, and identical on every render
const orders = schema.tables.orders;

export const RevenueQuery = defineQuery({
  source: orders,
  aggregations: [aggregations.sum(orders.fields.total)],
  breakouts: [breakout(orders.fields.createdAt, { unit: "month" }), breakout(orders.fields.plan)],
});

// the component supplies only what the UI changes
const { data } = useMetabaseQuery(RevenueQuery, {
  filters: plan === null ? [] : [filter(orders.fields.plan, "=", plan)],
});
```

Split them this way even when nothing appears to depend on it: the first argument must be identical on every render, and only the second may vary with runtime state.

The dynamic clauses run as their own stage, so they see the **result columns** of the static query, not its source table. That is why `plan` is a breakout above: a control that filters on a source column only works if that column survives into the result. If it does not, add it as a breakout, or leave the static query unaggregated. Likewise, filter an aggregated static query on `count`/`sum`, not on the fields behind them.

**Segments and measures belong to the static part only.** They are defined against a table, and the dynamic stage has no table — so `filters: [orders.segments.completed]` and `aggregations: [orders.measures.revenue]` are rejected, at compile time and again at runtime. This is the one place the usual "prefer the curated definition" rule does not apply.

Put the curated definition in the static query where it resolves, and let the dynamic clause work on what came out:

```ts
export const CompletedOrders = defineQuery({
  source: orders,
  filters: [orders.segments.completed], // the segment resolves here
  aggregations: [orders.measures.revenue],
  breakouts: [breakout(orders.fields.plan)],
});

const { data } = useMetabaseQuery(CompletedOrders, {
  // a result column, not a segment or measure
  filters: plan === null ? [] : [filter({ type: "column", name: "PLAN" }, "=", plan)],
});
```

If a control must switch a segment on and off, that is a choice between static queries, not a dynamic clause: define one query per state and pick the query, or express the same condition as a filter on a result column.

Do not remove or hand-edit `savedQuestionSourceId` if you find it on a query object, or `copiedActionId` on an action definition. Both are generated synchronization state — see _Synchronize every query and action_.

## More

- `references/checklist.md` — the final checks before handoff and the common mistakes. Read it before declaring the app done.
- `references/query-recipes.md` — table and metric aggregation recipes.
- `references/filters.md`, `references/filter-ui-patterns.md` — filters, breakouts and their controls.
- `references/rendering.md`, `references/visualization-settings.md` — SDK-rendered views, result shapes and presentation.
