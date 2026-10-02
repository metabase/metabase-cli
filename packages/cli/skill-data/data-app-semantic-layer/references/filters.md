# Filters and breakouts

## Filters And Breakouts

Use helpers because they give better autocomplete and shorter errors.

```ts
filter(ordersTable.fields.quantity, ">", 0);
filter(ordersTable.fields.status, "contains", "paid");
filter(ordersTable.fields.quantity, "between", [10, 20]);
filter(ordersTable.fields.status, "not-empty");

breakout(ordersTable.fields.createdAt, { unit: "month" });
breakout(ordersTable.fields.amount, {
  binning: { strategy: "num-bins", "num-bins": 10 },
});
breakout(ordersTable.fields.state);

orderBy(ordersTable.fields.createdAt, "desc", { unit: "month" });
```

Do not hand-write `orderBys` object literals such as `{ field, direction }` or `{ fieldId, direction }`; use `orderBy(...)`. When ordering the same date field used by a date breakout, pass the same `unit` to both `breakout(...)` and `orderBy(...)`.

For top-N grouped summaries, order by the aggregation result, not the raw source field. Store the aggregation helper in a local constant and pass that same constant to both `aggregations` and `orderBy(...)`:

```ts
// queries/inventory.query.ts
const avgQuantity = aggregations.avg(inventoryTable.fields.quantityOnHand);

export const TopIngredientsByQuantity = defineQuery({
  source: inventoryTable,
  aggregations: [avgQuantity],
  breakouts: [breakout(inventoryTable.fields.ingredient)],
  orderBys: [orderBy(avgQuantity, "desc")],
  limit: 15,
});
```

For user-selectable sorting, the sort is runtime state, so it belongs in the hook's second argument. Build a typed map of allowed generated fields instead of indexing the whole `fields` object:

```ts
type SortKey = "revenue" | "orders";
type ScorecardTable = typeof scorecardTable;

type ScorecardField = ScorecardTable["fields"][keyof ScorecardTable["fields"]];

const sortFields = {
  revenue: scorecardTable.fields.netRevenue,
  orders: scorecardTable.fields.orders,
} satisfies Record<SortKey, ScorecardField>;

const { data } = useMetabaseQuery(Scorecard, {
  orderBys: [orderBy(sortFields[sortKey], "desc")],
});
```

`Scorecard` is the unaggregated `defineQuery({ source: scorecardTable })` export in `queries/`; its source fields survive into the result, so the dynamic stage can order by them.

For metric queries, pass generated metric dimensions to `filter(...)` and `breakout(...)`:

```ts
filter(revenueMetric.dimensions.orders.status, "=", "paid");
breakout(revenueMetric.dimensions.orders.createdAt, { unit: "month" });
```

Filter operator rules:

- string: `=`, `!=`, `contains`, `does-not-contain`, `starts-with`, `ends-with`, `is-empty`, `not-empty`, `is-null`, `not-null`
- number: `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `is-null`, `not-null`
- date: `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `time-interval`, `is-null`, `not-null`
- boolean: `=`, `is-null`, `not-null`

Only date dimensions can use `unit`. Non-date dimensions can be used as breakouts without `unit`; numeric dimensions can use `binning`.

Segments are already filters:

```ts
filters: [
  schema.tables.records.segments.activeRecords,
  filter(schema.tables.records.fields.amount, ">", 100),
];
```

Use curated segments first when they exactly match the product intent. Use `filter(...)` when the UI needs a threshold, category, date range, text match, boolean condition, or other narrowing that is not already represented by a curated segment.

## Filter UI Patterns

When the user asks for custom filters, build normal React controls that feed semantic query filters.

Before implementing filters, create a filter contract for the visible dashboard. At minimum, identify:

- For each filter, name the runtime query that provides its options.
- For each filter, name the raw value used in `filter(...)`.
- For each card, table, KPI, and trend, name the generated table field or metric dimension that can receive that filter.
- If a filter only applies to one section, keep it section-scoped or omit it from the global filter bar.
- If a page needs a different date field such as `snapshotDate`, use one visible date control for that page.
- KPI/detail pairs that describe the same concept should use the same relevant filters.

Use the detailed checklist in `references/filter-ui-patterns.md` for filter state rules, runtime categorical options, stale option reset, searchable controls, and custom date-picker implementation.

For the common memoized date/category filter shape:

```tsx
type DatePreset = "30d" | "90d" | "custom" | "all";

const [datePreset, setDatePreset] = useState<DatePreset>("all");
const [customRange, setCustomRange] = useState<[string | null, string | null]>([null, null]);
const [status, setStatus] = useState("all");

const dateRange = useMemo((): readonly [string, string] | null => {
  if (datePreset === "all") {
    return null;
  }

  if (datePreset === "custom") {
    const [start, end] = customRange;
    return start && end ? [start, end] : null;
  }

  return getPresetDateRange(datePreset);
}, [datePreset, customRange]);

const orderFilters = useMemo(
  () => [
    ...(dateRange ? [filter(ordersTable.fields.createdAt, "between", dateRange)] : []),
    ...(status === "all" ? [] : [filter(ordersTable.fields.status, "=", status)]),
  ],
  [dateRange, status],
);
```

`customRange` above is what `<DateRangePopover value={customRange} onChange={setCustomRange}>` stores, so there is nothing to convert. When a fallback picker's state uses `Date | null`, convert selected dates with a local `YYYY-MM-DD` formatter before passing them to `filter(..., "between", range)`. Use that local formatter rather than `date.toISOString().split("T")[0]`, which shifts the day.
