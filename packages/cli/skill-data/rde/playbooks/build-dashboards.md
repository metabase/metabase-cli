# Build dashboards

Applies: the semantic layer exists and the user wants something to look at. Produces a content plan, a draft reviewed on screen, card and dashboard files composing definitions by `entity_id`, a plausibility pass, delivery per audience. No definitions yet: say so and offer [`build-semantic-layer.md`](build-semantic-layer.md).

Checklist (copy into TodoWrite; a resumed session reads the todo list and STATE.md first): `1 STATE.md` `2 content plan` `3 draft` `4.<card> build` `5 page: text, filters, layout` `6 plausibility` `7 delivery` `8 final collection` `reply`.

Read first: [`dashboard-content-design.md`](../references/dashboard-content-design.md), [`state.md`](../references/state.md), and the domain file STATE.md names. File mechanics: `mb skills get dashboard`, `mb skills get visualization`.

## Commands you will run

```bash
mb query --file ./.scratch/card.json --dry-run; mb query --file ./.scratch/card.json --fields status,data.rows   # the card's query, run form
mb entity-id --count 6; mb uuid
mb validate collections/main/drafts
git add -A collections && git commit -m "<dashboard>: <what and why>" && git push
mb git-sync import --branch "$BRANCH" --json
mb eid --model card <eid1,eid2> --json; mb eid --model dashboard <eid> --json
mb card query <card-id> --fields status,data.rows --json          # equals STATE.md's verified number
mb dashboard get <dash-id> --json; mb dashboard cards <dash-id> --json
mb dashboard parameter-values <dash-id> <parameter-id> --json
```

Files (metric, segment and field from STATE.md, all by `entity_id` or natural key), each also carrying `entity_id`, `creator_id` and `serdes/meta`:

```yaml
# a trend card
name: MRR by month, paying accounts
display: line
collection_id: <drafts entity_id>
visualization_settings: {}
dataset_query:
  "lib/type": mbql/query
  database: Warehouse
  stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Warehouse, analytics, mart_billing_fct_customer_month]
      aggregation: [[metric, {}, <metric entity_id>]]
      filters: [[segment, {}, <segment entity_id>]]
      breakout:
        [
          [
            field,
            { temporal-unit: month },
            [Warehouse, analytics, mart_billing_fct_customer_month, period_month],
          ],
        ]
---
# a KPI card: the same query, display smartscalar
visualization_settings:
  scalar.comparisons:
    - { id: c1, type: previousPeriod }
    - { id: c2, type: staticNumber, value: 100000, label: Target }
---
# the dashboard
name: CEO weekly
collection_id: <drafts entity_id>
parameters:
  - { id: <mb uuid>, name: Period, slug: period, type: date/month-year }
dashcards:
  - entity_id: <mb entity-id>
    card_id: null
    col: 0
    row: 0
    size_x: 24
    size_y: 2
    visualization_settings:
      virtual_card: { display: text }
      text: "Data through August 2026; September flagged incomplete. Refreshed daily 03:00 UTC, a day behind billing. MRR: Reconciled to finance on 2026-09-12, within 1%. Churn: Draft, provisional decisions: D7."
  - entity_id: <mb entity-id>
    card_id: <KPI card entity_id>
    col: 0
    row: 2
    size_x: 6
    size_y: 3
    parameter_mappings:
      - parameter_id: <the Period id>
        card_id: <KPI card entity_id>
        target:
          [
            dimension,
            [field, [Warehouse, analytics, mart_billing_fct_customer_month, period_month], null],
          ]
```

A measure sits in the same slot as `[measure, {}, <entity_id>]`; on a model the stage reads `source-card: <model entity_id>` instead of `source-table`; a number this shape cannot express is a gap: log it in STATE.md Questions and define it first.

## 1. STATE.md

Read it; every Questions row this page uses carries a metric or measure id and a verification result.

## 2. Content plan

Per audience and cadence, shaped like the finished plan in `dashboard-content-design.md`: the decision the page serves; per card the question, definition, segment, breakout, display; per KPI the comparison, target (ask, never invent), drill, alert; the subscription; what is left off and why. Card choices are `[DECIDED, reversible]`; more than one audience or cadence where the split is the user's call is a `[CHECKPOINT]`.

## 3. Draft, then review on screen

Per `dashboard-content-design.md`, Draft, then review on screen: build in `Drafts`, import, hand back the link, the card list, and the omissions.

## 4. Cards

One card file per plan entry, naming the metric, measure, or segment by `entity_id`, adding only a breakout and a display; prove the query in the run form with `mb query` before writing the file. After the import, the card's headline (`mb card query`) equals the number verified in STATE.md; a mismatch means the card added a filter. Read the card back; set `graph.dimensions` and `graph.metrics` (output column names) only when the auto-pick is wrong: `mb skills get visualization`, "Minimum-viable settings per chart family".

## 5. The page

A text card at the top: data through, refresh (the job's schedule, never a hope), lag, the trust label per headline; a `Definitions` text card at the foot with the first sentence of each headline's description. Filters per `dashboard-content-design.md`: one date filter per date basis, mapped to the metric's time column on every card sharing it. Layout: `mb skills get dashboard`, "Layout: the grid is 24 columns, not 12"; drills and cross-filters from "Choose the interaction" when the plan calls for them.

## 6. Plausibility pass

Per `dashboard-content-design.md`, after the import; chase every implausible number; never ship it with a caveat; dropdowns populated (`mb db rescan-values $DB` if stale).

## 7. Delivery per audience

Readers who do not open Metabase: a subscription on the cadence, which is set in Metabase, not in this repository; write the schedule and recipients into the hand-back for the user to set up (mail to real people is irreversible, `[CHECKPOINT]` on recipients). Prose readers: a document file embedding the cards (`mb skills get document`, "Embedding cards"). Numbers not to miss: an exception card that returns rows only when the thing happened, and a request to the owner to put an alert on it.

## 8. Final collection

Move the dashboard after the pass: set `collection_id` on it and its cards to the final collection (move the files to that folder too), validate, commit, import; record it in the STATE.md Questions rows.

## Done when

Every card traces to a Questions row and composes a definition by `entity_id`; text card, date filters, and definitions card are on the page; every file is committed and imported; the plausibility pass is clean; every audience in the plan has its delivery or a written request; omissions written down.

## Reply

The five-part hand-back in `collaboration-contract.md`; under part three: the cards in reading order by the question each answers, what was left off and why, each KPI's comparison and target.
