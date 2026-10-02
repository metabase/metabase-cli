# Query recipes

## Table query recipes

For a table query, pass the generated table object as `source`:

```ts
// queries/records.query.ts
const recordsTable = schema.tables.records;

export const RecordStatuses = defineQuery({
  source: recordsTable,
  fields: [recordsTable.fields.id, recordsTable.fields.status],
});
```

For grouped table summaries, include at least one aggregation:

```ts
export const ActiveAmountByMonth = defineQuery({
  source: recordsTable,
  filters: [recordsTable.segments.activeRecords, filter(recordsTable.fields.amount, ">", 100)],
  aggregations: [recordsTable.measures.totalAmount],
  breakouts: [breakout(recordsTable.fields.createdAt, { unit: "month" })],
  orderBys: [orderBy(recordsTable.fields.createdAt, "desc", { unit: "month" })],
});
```

For basic aggregations without a curated measure, use the `aggregations` helpers:

```ts
export const AmountByCategory = defineQuery({
  source: recordsTable,
  aggregations: [aggregations.count(), aggregations.sum(recordsTable.fields.amount)],
  breakouts: [breakout(recordsTable.fields.category)],
});
```

When a query uses the same helper more than once, give each one a `name`. The name becomes the result column's name and the row key, it is typed, and it is how `orderBy(...)` and runtime clauses refer to that aggregation. Without names, the columns come back as `sum`, `sum_2`, and so on, and sorting or filtering by one of them fails:

```ts
const totalAmount = aggregations.sum(recordsTable.fields.amount, {
  name: "total_amount",
});
const totalTax = aggregations.sum(recordsTable.fields.tax, {
  name: "total_tax",
});

export const TaxByCategory = defineQuery({
  source: recordsTable,
  aggregations: [totalAmount, totalTax],
  breakouts: [breakout(recordsTable.fields.category)],
  orderBys: [orderBy(totalTax, "desc")],
});
// Rows are keyed `total_amount` and `total_tax`.
```

Table fields, segments, measures, filters, breakouts, and orderBys must come from the queried table. Use `defineQuery<RecordsTable>({ ... })` when you want TypeScript to validate that ownership at the definition.

## metric aggregation recipes

For a metric-backed query, pass the generated table object as `source` and the generated metric object in `aggregations`:

```ts
// queries/revenue.query.ts
const ordersTable = schema.tables.orders;
const revenueMetric = schema.metrics.revenue;

export const Revenue = defineQuery({
  source: ordersTable,
  aggregations: [revenueMetric],
});
```

Use generated metric dimensions for filters and breakouts in queries that aggregate the owning metric. Dimensions from the metric's source table work directly. Dimensions from related tables also work when the generated field includes `sourceFieldId`; prefer those related-table dimensions for readable labels instead of grouping by raw foreign key IDs:

```ts
export const PaidRevenueByMonthAndFranchise = defineQuery({
  source: ordersTable,
  aggregations: [revenueMetric],
  filters: [filter(revenueMetric.dimensions.orders.status, "=", "paid")],
  breakouts: [
    breakout(revenueMetric.dimensions.orders.createdAt, { unit: "month" }),
    breakout(revenueMetric.dimensions.franchises.name),
  ],
  orderBys: [
    orderBy(revenueMetric.dimensions.orders.createdAt, "desc", {
      unit: "month",
    }),
  ],
});

// Prefer readable related-table dimensions when available.
breakout(revenueMetric.dimensions.franchises.name);

// Avoid raw FK IDs when the related-table dimension exists.
breakout(revenueMetric.dimensions.orders.franchiseId);
```

Queries backed by metrics can include helper aggregations over generated metric dimensions. They can also use compatible saved Segments and Measures from the table source when the generated schema exposes them:

```ts
export const CompletedRevenueByStatus = defineQuery({
  source: ordersTable,
  filters: [schema.tables.orders.segments.completed],
  aggregations: [
    revenueMetric,
    schema.tables.orders.measures.totalRevenue,
    aggregations.sum(revenueMetric.dimensions.orders.amount),
  ],
  breakouts: [breakout(revenueMetric.dimensions.orders.status)],
});
```

A metric aggregation must belong to the table source. Do not use source-card metrics in table-source queries. Generated metric dimensions are scoped to their owning metric: if a query uses `revenueMetric.dimensions.*` in filters, helper aggregations, breakouts, or orderBys, it must also include `revenueMetric` in `aggregations`. Do not use metric dimensions as standalone table fields for unrelated `count()` or table-measure queries. Generated metric dimensions must also resolve to the table source. Use `defineQuery<typeof ordersTable>({ ... })` when you want TypeScript to validate that at the definition.
