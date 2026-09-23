# Build the semantic layer

Applies: final-layer tables exist with rows. Produces one starting object per table, the definitions as files on the branch with descriptions, verified, and the canonical set published or filed.

Checklist (copy into TodoWrite; a resumed session reads the todo list and STATE.md first): `1 STATE.md` `2 starting objects` `3.<table> metadata` `4 Questions` `5 conformed dims` `6.<definition> define` `7 describe` `8 verify` `9 publish, owners` `reply`.

Read first: [`semantic-layer-design.md`](../references/semantic-layer-design.md), [`entities-and-time.md`](../references/entities-and-time.md), and the domain file STATE.md names.

## Commands you will run

```bash
mb search "<the user's wording>" --models metric,measure,segment,dataset --json
mb table get <table-id> --include fields --json          # numeric ids for the run form
jq . ./.scratch/metric.json | mb query --file - --dry-run   # the metric's query in the run form
mb query --file ./.scratch/metric.json --fields status,data.rows
mb entity-id --count 4
mb validate databases collections
git add -A databases collections && git commit -m "<definitions>: <what and why>" && git push
mb git-sync import --branch "$BRANCH" --json
mb eid --body '{"entity_ids":{"card":["<metric eid>"],"measure":["<measure eid>"],"segment":["<segment eid>"]}}' --json
mb card query <metric-id> --json
mb library publish --table-ids <ids>
```

Files (database `Warehouse`, table `analytics.mart_billing_fct_customer_month`, a measure and a segment under `databases/warehouse/schemas/analytics/tables/mart_billing_fct_customer_month/`, the metric under its collection's folder):

```yaml
# measures/recurring_revenue.yaml
name: Recurring revenue
description: Recurring revenue, USD.
entity_id: <mb entity-id>
creator_id: <STATE.md creator>
definition:
  "lib/type": mbql/query
  database: Warehouse
  stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Warehouse, analytics, mart_billing_fct_customer_month]
      aggregation:
        - [
            sum,
            { name: mrr_usd },
            [field, {}, [Warehouse, analytics, mart_billing_fct_customer_month, mrr_usd]],
          ]
serdes/meta:
  - { id: <entity_id>, label: recurring_revenue, model: Measure }
---
# segments/complete_periods.yaml
name: Complete periods
description: Months fully loaded.
definition:
  "lib/type": mbql/query
  database: Warehouse
  stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Warehouse, analytics, mart_billing_fct_customer_month]
      filters:
        - [
            =,
            {},
            [
              field,
              {},
              [Warehouse, analytics, mart_billing_fct_customer_month, is_complete_period],
            ],
            true,
          ]
---
# collections/main/definitions/monthly_recurring_revenue.yaml
name: Monthly recurring revenue
type: metric
display: line
collection_id: <Definitions or Library Metrics collection entity_id>
visualization_settings: {}
dataset_query:
  "lib/type": mbql/query
  database: Warehouse
  stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Warehouse, analytics, mart_billing_fct_customer_month]
      aggregation: [[measure, {}, <measure entity_id>]]
      breakout:
        [
          [
            field,
            { temporal-unit: month },
            [Warehouse, analytics, mart_billing_fct_customer_month, period_month],
          ],
        ]
```

Each file also carries `entity_id`, `creator_id` and `serdes/meta` as the first shows. The aggregation slot per definition: a sum `[sum, {name: mrr_usd}, [field, {}, <field>]]`; `count-where` `[count-where, {name: churned}, [=, {}, [field, {}, <state field>], churned]]`; `share` `[share, {name: activation_rate}, [not-null, {}, [field, {}, <activated_at field>]]]`; a derived metric `[metric, {}, <metric entity_id>]`. A definitional filter goes in `filters` of the same stage. On a model the stage reads `source-card: <model entity_id>` instead of `source-table`. Prove each query in the run form with `mb query` first (`mb skills get mbql`, "From the run form to the file form").

## 1. STATE.md and tables

Read STATE.md; every Models row a definition needs has `table_id` and rows, and the table is in `.metadata/databases/` or readable with `mb table get`; a missing one goes back to [`build-clean-tables.md`](build-clean-tables.md).

## 2. One starting object per table

Per `semantic-layer-design.md`: the curated table (Library or not), no model over it; a model only where people start from a join, metrics only. `[DECIDED, reversible]`.

## 3. Metadata chain

Per defining table in `semantic-layer-design.md`'s order, where `mb skills get metadata` says each setting lives; gaps left by `build-clean-tables.md` step 6 close here.

## 4. Questions table

Each STATE.md Questions row gets a home table, a time column (the date basis), the definitional filter, breakouts (own or FK), exists or build. Two owners defining one number differently: `[CHECKPOINT]` with both numbers.

## 5. Conformed dimensions

A breakout shared by two home tables lives once on an entity table reached by a metadata foreign key (`entities-and-time.md`), never copied; a metric reads it through `source-field` (`mb skills path mbql`, "Joins and FK traversal").

## 6. Define in ladder order

Measures; metrics over measures by `entity_id`; derived metrics over metrics; segments; on a model, metrics only. Each is a file, validated, committed, and imported before a later definition reads it by id on the instance. Definitional filters live inside the definition; slicing filters are segments. A metric with a time column carries a monthly breakout and `display: line`, otherwise `scalar`.

## 7. Describe

Trust label first, per the contract; then what it counts and excludes with the largest exclusion's size, restatement, what it must not be compared to, the owner. A segment: what it includes, excludes, why, its warning.

## 8. Verify

The four checks under Verify before handing back in `semantic-layer-design.md`, each result written to the Questions row's `status`; a headline over tolerance goes to [`validate-and-reconcile.md`](validate-and-reconcile.md).

## 9. Publish or file, then owners

Canonical set and cascade guard per `semantic-layer-design.md`, Library. Publishing is irreversible, `[CHECKPOINT]`, never while a decision it reads is open. Metrics enter the Library by setting their file's `collection_id` to its Metrics collection; no Library: a `Definitions` collection, stated. Changing a delivered definition: the flow in `semantic-layer-design.md`. An owner on every final-layer table and transform; every description ends with the owner; ask the user to mark canonical metrics verified in the UI (the CLI cannot).

## Done when

Every Questions row resolves to named objects with a verification result or is marked unanswerable with the reason; every definition is a committed, imported file; the canonical set is published or filed; owners set.

## Reply

The five-part hand-back in `collaboration-contract.md`; under part three: the objects by kind with their meaning, the held-out question and its answer, definitions still proposals.
