# Rendering query results

## SDK-rendered views

Table fields, segments, measure aggregations, and metric aggregations must come from the queried table. Generated metric dimensions used in filters, helper aggregations, breakouts, and orderBys must resolve to the queried table and belong to a metric included in the same query's `aggregations`.
When table queries use `fields`, `segments`, `aggregations`, `breakouts`, or `orderBys`, let `defineQuery` infer the shape, or write `defineQuery<typeof recordsTable>` when ownership validation matters more than precise result-row keys.

## Interactive Metabase Views

Whether an element is an SDK question at all — and whether it is `StaticQuestion` or `InteractiveQuestion` — is decided by _Rendering a chart: Metabase first_ in the `data-app` skill's `references/sdk-surface.md`. Once it is: declare the query in `queries/`, resolve it with `useMetabaseQueryObject(TheQuery)`, then pass the result through the SDK question component's `card` prop.

`useMetabaseQueryObject` supports generated table queries, including metric aggregations. Use `useMetabaseQuery` when custom React needs direct row data; use `useMetabaseQueryObject` when Metabase should render or manage the visualization. Do not pass generics to `useMetabaseQueryObject`; it returns `{ query, error, isLoading }`, not query result rows.

The examples under _Rendering With SDK Components_ use `return null` for minimal loading and error handling. In a real app, render the app's existing loading or error UI there. Passing `card={{ query }}` is safe while `query` is `null`; do not pass the full `{ query, error, isLoading }` hook result as `card.query`.

When wrapping `useMetabaseQueryObject` in a reusable chart/card component, destructure and render `error`; do not read only `{ query }`, because query-construction failures otherwise look like endless loading. Calling the hook inside that child component is valid React. Do not call hooks directly inside loops, conditions, or callbacks in the parent component.

Wrong/right pattern:

```tsx
const trendQuery = useMetabaseQueryObject(TrendQuery);
<InteractiveQuestion card={{ query: trendQuery }} />; // wrong

const { query: trendQuery } = useMetabaseQueryObject(TrendQuery);
<InteractiveQuestion card={{ query: trendQuery }} />; // right
```

Hook typing:

- Both hooks take a `defineQuery` export imported from `queries/` and nothing else; an inline object is a compile error. Write no generics on the hooks.
- `useMetabaseQuery(...)` infers typed row data from the definition. Put `defineQuery<typeof table>` on the definition when ownership validation matters.
- `useMetabaseQueryObject(...)` returns `{ query, error, isLoading }`. Pass the `query` property to `card={{ query }}`.
- Fix query typing errors at the definition (`defineQuery<typeof table>(...)`) rather than with `as Parameters<typeof useMetabaseQuery>[0]` or `as DefinedQuery`. The first hides invalid table fields, metric aggregations, and breakouts; the second hides an unsynchronized query that fails in production.

The basic prop contract is:

- Generated table query, including metric aggregations: `<StaticQuestion card={{ query }} />`
- Full interactive question: `<InteractiveQuestion card={{ query }} />`

When you need the set of SDK-supported question displays, do not copy a local list. In generated apps, search `node_modules/@metabase/embedding-sdk-react/dist/index.d.ts` for the exact declaration `declare const cardDisplayTypes: readonly [...]` and use that tuple as the source of truth. Do not read the whole declaration file into context.

Always pass SDK-rendered ad hoc questions with a `card` object. Start with `card={{ query }}` when the user has not asked for a specific chart type and Metabase defaults can infer a reasonable display from the query. Use `card={{ query, visualization }}` when the user request or design calls for a specific chart type, such as a pie chart for a distribution, but does not ask for setting-level customization. Add `visualizationSettings` only when the user explicitly asks for a setting-level presentation change, such as hiding or renaming an axis label, showing value labels, stacking bars, adding a goal line, ordering table columns, showing pie totals/labels, or controlling series/slice order. Search `node_modules/@metabase/embedding-sdk-react/dist/index.d.ts` for `export declare type MetabaseCard`, the relevant `*VisualizationSettings` type, and any setting key you plan to use. Read the JSDoc comments attached to those declarations, then use the TypeScript declarations as the source of truth for legal `visualization` and `visualizationSettings` combinations. Build the query with `useMetabaseQueryObject`; do not call internal query resolution helpers, cast through `any`, or hardcode settings from memory.

For lightweight descriptions of the exposed settings and when to use them, read [visualization-settings.md](visualization-settings.md). Treat that file as guidance only; the installed SDK declaration decides what is legal.

Before writing a `card`, check `node_modules/@metabase/embedding-sdk-react/dist/data-app.d.ts` for the `useMetabaseQueryObject` return type. Destructure the returned `query` and use that value in `card.query`; for configured cards, type the object with `satisfies MetabaseCard`. If TypeScript reports duplicate opaque `DatasetQuery` symbols, do not force a cast; update the SDK package before using `card`.

Do not invent alternate prop names for generated queries or visualization settings. If the SDK type says a prop does not exist, believe it and use the documented `card` prop shape.

When `useMetabaseQuery` is needed, map typed rows into an explicit local view model using named properties before rendering:

```ts
const orderedAtKey = ordersTable.fields.orderedAt.name;

const chartRows = (data?.rows ?? []).map((row) => ({
  label: String(row[orderedAtKey] ?? "Unknown"),
  value: row.count,
}));
```

If the result key only comes from `data.columns` at runtime, use `rawRows` with the matching column position, or narrow the key to a literal before indexing `data.rows`.

### Rendering With SDK Components

Chart only, without the toolbar:

```tsx
import {
  InteractiveQuestion,
  StaticQuestion,
  type MetabaseCard,
} from "@metabase/embedding-sdk-react";

import { useMetabaseQueryObject } from "@metabase/embedding-sdk-react/data-app";

import { AmountByMonth } from "../../queries/events.query";

const { query, isLoading, error } = useMetabaseQueryObject(AmountByMonth);

if (error) {
  return null;
}

if (isLoading || !query) {
  return null;
}

return (
  <InteractiveQuestion card={{ query }}>
    <InteractiveQuestion.QuestionVisualization height="500px" />
  </InteractiveQuestion>
);
```

Configured SDK visualization:

```tsx
// queries/events.query.ts
export const TotalAmountByMonth = defineQuery({
  source: eventsTable,
  aggregations: [eventsTable.measures.totalAmount],
  breakouts: [breakout(eventsTable.fields.occurredAt, { unit: "month" })],
});

// the component
const { query, isLoading, error } = useMetabaseQueryObject(TotalAmountByMonth);

if (error) {
  return null;
}

if (isLoading || !query) {
  return null;
}

const trendCard = {
  query,
  visualization: "bar",
  visualizationSettings: {
    "graph.show_values": true,
    "graph.y_axis.title_text": "Total amount",
  },
} satisfies MetabaseCard;

return (
  <InteractiveQuestion card={trendCard}>
    <InteractiveQuestion.QuestionVisualization height="500px" />
  </InteractiveQuestion>
);
```

## Result Shape And Charts

- Prefer keyed `data.rows`.
- Never treat `data.rows` as positional arrays. Do not use `row[0]`, `row[1]`, `DisplayRow`, or tuple casts for `useMetabaseQuery` row objects.
- Inspect `data.columns` before mapping low-level `rawRows`, but do not use arbitrary `data.columns[].name` strings to index typed `data.rows`.
- Runtime row objects are keyed by returned Metabase column names, usually `column.name` such as `total_amount` or `average_score`. Do not assume generated schema keys like `totalAmount` or `averageScore` are runtime row keys.
- For generated field references, the React property path and runtime result key can differ: `schema.tables.orders.fields.orderedAt.name` might be `ordered_at`. Use `row[ordersTable.fields.orderedAt.name]`, `row.count`, or `data.columns` metadata instead of guessing `row.orderedAt`.
- Treat row values as nullable. Guard before calling number/string methods such as `toFixed`, `toLocaleString`, or string transforms.
- Use `rawRows` only for known positional shapes.
- Aggregation columns may be named `count`, `sum`, or `avg`; match metadata when needed.
- If a query has several helper aggregations of the same kind, such as multiple `aggregations.sum(...)` calls, name each one (`{ name: "..." }`) and read the rows by those names. Never depend on generated names like `sum_2`.
- Grouped queries can include a `null` breakout bucket. Render it as `"Unknown"` or filter it out deliberately.
- Time-series charts need multiple ordered buckets. Do not fake sparklines for scalar or one-point results.
- Multi-series charts with different units or magnitudes need separate axes or normalization.
- Format user-facing values: currency to at most 2 decimals, counts as whole numbers, dates as readable labels.
- Do not render ambiguous derived business values unless the semantic layer description or inspected sample values make the meaning and units obvious.
- Empty results are distinct from loading. After `isLoading` is false, render a clear empty state instead of leaving a skeleton or blank KPI.

## Presentation Guidance

Prefer Metabase-rendered panels for chart-shaped and table-shaped data. The React app may group, sort, format, and derive display-only values from `data.rows` when a custom panel is justified, but do not make custom panels the default.

Good transforms:

- Group rows for summaries.
- Sort and slice rows for ranked lists only when a custom list is clearly better than a Metabase row/bar/table visualization.
- Pick chart types from actual data shape, and prefer Metabase `bar`, `line`, `area`, `row`, `combo`, `pivot`, and `table` displays before writing custom chart code.
- Show loading, error, and empty states.
- Bound dense result displays. Tables, alert lists, logs, and ranked lists should use a top-N slice, grouping, pagination, or a fixed/max-height scroll area so a large result set cannot stretch the entire page.

When a page feels like a raw table browser, look for schema-backed ways to enrich it:

- Use segments for curated subsets like active, completed, overdue, high-priority, or needs-attention records.
- Use measures for curated aggregations instead of recalculating everything ad hoc in React.
- Use metrics when the schema exposes a curated metric aggregation for the page's core business question.
- Use filters to focus the query on the UI's intent.
- Use breakouts to create trends, category comparisons, and grouped summaries.
- If the enriched result is still a sortable/drillable table, render it with SDK visualization components instead of rebuilding table behavior in React.

Avoid manual classification when the semantic layer already has the concept. Prefer curated segments, fields, or measures over string matching, threshold heuristics, or category reconstruction in React.

If no curated schema entry supports the intended UI, leave the section out or ask for semantic-layer curation. Do not keep mock data or placeholder analytics in the finished app.
