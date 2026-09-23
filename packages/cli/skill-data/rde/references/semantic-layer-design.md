# Semantic layer design

Which kind of definition a number needs, the metadata chain, and how definitions are owned, verified, and changed; the router sends you here before any definition or metadata edit. Extend an existing definition (discovery: [layering-and-naming.md](layering-and-naming.md)), never a parallel one; two saved questions disagreeing about one number reconcile under [reconciliation.md](reconciliation.md).

## Which kind of definition

| Kind      | Stands for                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Model     | the starting object only where people start from a join; metrics only on it (`source-card`); the Library is not required for a curated table |
| Metric    | the published number: one aggregation, its definitional filter, its time dimension                                                           |
| Measure   | the formula, once, on one table                                                                                                              |
| Segment   | a slicing filter, on one table                                                                                                               |
| Transform | a calculated column, a join, anything changing what a row means; built before the metric reads it                                            |

- Filters. Definitional (non-test, recognised, complete periods) is part of the number: a transform-computed flag inside the metric's own query. Slicing (region, plan) is a segment or a dashboard filter. `Paid revenue` is its own metric over the base metric, so the formula is written once.
- Ladder, in build order: measure `definition` with exactly one aggregation, `[sum, {}, [field, {}, [<db>, <schema>, <table>, mrr_usd]]]`; headline metric `aggregation: [[measure, {}, <measure entity_id>]]` plus definitional `filters`; derived metric `[metric, {}, <metric entity_id>]` in the aggregation slot, arithmetic over two for a ratio; a card slices with `filters: [[segment, {}, <segment entity_id>]]`. On an instance without measures the headline metric carries the formula itself.
- One starting object per table, the curated table by default (Library or not): plumbing columns hidden, display names, descriptions, and no model over it, because measures and segments never show on a model. A model only where people start from a join, and then metrics only.
- A segment or measure never follows its table into a join, nested question, or model. A breakout crosses a metadata foreign key with no join: `[field, {source-field: <fk field>}, <target field>]`, both natural keys in a file. Widen with a transform only for columns a measure or segment reads; one fact per grain plus conformed entity tables ([entities-and-time.md](entities-and-time.md)) beats a wide table per question; never copy tables the company maintains elsewhere.

## Time dimension and display on every metric

A metric with a time column carries it as a monthly `temporal-unit` breakout in its `dataset_query` with `"display": "line"`; that breakout is its default time dimension and a trend card inherits it. One with none is `"display": "scalar"`.

## The metadata chain

In this order on every table you define against, each for what it unlocks; no metric before the pass. Where each setting is written, a Library-published table's metadata files or a request to the user, is in `mb skills get metadata`.

1. Only final-layer tables in the Library (`mb library publish --table-ids <ids>`): the picker's curated surface offers the final layer. Raw, staging, and intermediate tables stay unpublished; where the user wants them out of the picker entirely, `visibility_type: technical` on each is a request to them.
2. `entity_type` per final-layer table (`entity/UserTable`, `entity/EventTable`, ...): x-rays and Metabot know what a row is.
3. `type/PK` on the key; `type/FK` plus `fk_target_field_id` on every column naming another final-layer row: `source-field` joins, linked filters, Library cascade.
4. A semantic type on every column with business meaning (`type/Category` on breakouts, `type/Currency` on money, temporal types on dates): widget and formatting.
5. `has_field_values: list` on every column a dashboard filters by, `search` on high-cardinality ids and emails: dropdown versus search box.
6. `visibility_type: hidden` on plumbing columns, `details-only` on long text; `field_order` on the table.
7. `display_name` and `description` on every column people read: what search and Metabot rank by.
8. On the table: `description`, `caveats` (the standing caveats metric descriptions point to), the owner, `data_layer`.
9. After every job run that can add a category value, `mb db rescan-values <db-id>`; say in the hand-back that a scheduled rescan is the admin's to set.

## The Questions table

In STATE.md ([state.md](state.md)), one row per cluster with the columns there. Rows differing only in filter or breakout are one metric. The time column is the date basis, a reversible decision shown per the contract. A breakout shared by clusters on different home tables is a conformed dimension: once, on an entity table every home table reaches by foreign key, never copied onto each fact ([entities-and-time.md](entities-and-time.md)). A question the layer cannot answer is a gap row, never a one-off SQL card.

## Library

Canonical set: the home tables the Questions table names plus the entity tables they reach by foreign key; nothing atomic or intermediate. Ask for a yes on that list. Cascade guard: publishing cascades to upstream FK targets, so before `mb library publish --table-ids <ids>` every FK on a published table targets a final-layer table; a FK into staging publishes staging. Without the Library, `Definitions` is the canonical set.

## Own, file, change, retire

- Default filing, to confirm: one collection per business domain holding its dashboards, `Definitions` under it for metrics and models; the Library's Data and Metrics collections hold the canonical set (a metric's file sets `collection_id` to the Metrics collection's `entity_id`, from `mb library get` and `mb collection get <id> --fields entity_id`).
- Every final-layer table carries an owner; every metric description ends with its owner. The CLI cannot set the verified badge: ask the user to mark the canonical metrics verified in the UI, and say so in the hand-back.
- Change a delivered definition: dependents via `grep -rl <entity_id> collections databases` and `mb search "<name>" --models card,dashboard,metric,document --json`; before and after on the last three complete periods; edit the file in place, never a new `entity_id`, since dashcards hold it; prepend `Changed <date>: <what and direction>` to the description and say the same in the commit; re-verify; plausibility pass on every dependent card ([dashboard-content-design.md](dashboard-content-design.md)); tell the owners of the dashboards that moved which moved and by how much. A wrong shipped number: the restatement protocol in [collaboration-contract.md](collaboration-contract.md).
- A dispute between owners is a `[CHECKPOINT]` with both readings computed; the published one stands, described as disputed, until answered.
- Retire: a `Deprecated:` name prefix, description naming the successor, one cadence for cards to move, then `archived: true` in the file. Never delete the file.

## Verify before handing back

- Three surfaces agree: the measure summarised on the table (`mb query`), the metric (`mb card query <id> --json`), and a question aggregating the metric (`["metric", {}, <id>]` in `mb query`) return one number for one period.
- One held-out question from the user, not in the Questions table, answered in MBQL on a published table with measures, segments, and breakouts only, foreign-key breakouts included; needing native SQL is a gap to log.
- `mb search "<the user's own wording>" --models metric,measure,segment --json` returns the intended object first; else add the user's words to the description.
- One headline reconciled to an independent figure for one period ([reconciliation.md](reconciliation.md)); the rest carry `Self-consistent only`. `mb library get --json`: no staging table in Data.

## Finished examples

Metric description: `Self-consistent only, no external reference. Monthly recurring revenue at month end, in USD, from invoiced subscription lines spread over their service period. Excludes one-off charges, tax, and applied credits (one-offs: 4.1% of invoiced amount). Refunds do not reduce it. Prior months restate when a late invoice lands, usually under 0.5%. Not comparable to accounting revenue. Complete through August; September is on the table flagged incomplete. Owner: jo@acme.example.`

Segment description: `Paying accounts: plan is not plan_free and at least one paid invoice exists. Excludes trials and internal accounts (staff domain list, 23 accounts). A move from plan_plus to plan_basic is a downgrade, not churn. Owner: sam@acme.example.`
