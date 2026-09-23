# Explore raw data

Applies: raw data is synced into Metabase, or must be landed first, and nothing is modeled. Produces STATE.md with discovery and questions, a profile of every table on a named question's path, an inventory in the company's vocabulary, one decision memo, and the first slice started on defaults.

Checklist (copy into TodoWrite; a resumed session reads the todo list and STATE.md first): `1 land` `2 intake` `3 discover` `4 helper, counts` `5.<table> profile` `6 inventory` `7 memo` `8 first slice` `reply`.

Read first: [`state.md`](../references/state.md), [`profiling-catalog.md`](../references/profiling-catalog.md), and the domain file STATE.md names.

## Commands you will run

```bash
mb db list --json; mb db get $DB --include tables --json
mb db sync-schema $DB --wait --json               # after new tables land
ls .metadata/databases/                           # the schema on disk; mb skills get metabase-database-metadata
ls collections/ databases/ transforms/ 2>/dev/null; git log --oneline -5   # the content the repository already holds
mb git-sync status --json                         # the branch the instance holds, the synced collections
mb collection tree --json
mb transform list --fields id,name,description,target --json
mb search --models dataset,metric,measure,segment --db-id $DB --limit 50 --json
source ./.scratch/probe.sh                        # q() written once from references/state.md; pass is .status == "completed"
mb table list --db-id $DB --fields id,name,schema --json | jq -r --arg q "'" '.data[] | "SELECT \($q)\(.schema).\(.name)\($q) AS t, count(*) AS n FROM \(.schema).\(.name)"' | sed '$!s/$/ UNION ALL/' > ./.scratch/counts.sql
q "$(cat ./.scratch/counts.sql)"                  # all tables, one query
mb table get <table-id> --include fields --json
```

## 1. Data not yet in the warehouse

Landing data is the user's loader's job, untouched, into a schema Metabase reads; this CLI has no upload. Once it lands, `db sync-schema --wait`, and ask the user to refresh `.metadata/` (or run `mb metadata extract` when the instance offers it). Stop until `db get --include tables` lists the tables.

## 2. Intake

Ask in one message, in their words: the owner question from the contract; which questions this must answer, in the order they matter; whether a number you will build already exists somewhere, and its export at the finest grain; where the raw data sits if more than one database is visible. Documentation is welcome, never required; never an ERD. Each question goes verbatim into STATE.md Questions.

## 3. Discover once

Run the discovery commands once; write `db_id`, the database name, `engine`, schemas, layer vocabulary, collection `entity_id`s (from their files, or `mb collection get <id> --fields entity_id`), the `creator_id` the repository's files use, existing models and metrics (Questions rows marked `exists`), the branch, and the domain file the router's test fired into STATE.md; no later playbook re-discovers. Match what exists; a convention proposed because nothing exists is `[DECIDED, reversible]` on the `layering-and-naming.md` default, which also holds the outside-Metabase note.

## 4. Helper and counts

Write the helper once; source it every session. Count every table in one query; a statistics view may stand in above ten million rows, marked approximate. Zero rows: the contract's zero-row rule.

## 5. Profile only what a question touches

Per table on a question path: read its columns from `.metadata/databases/` (or `mb table get`), classify meaning versus loader plumbing (loader shape in `staging-rules.md`), then run the probe shapes in `profiling-catalog.md` (key uniqueness, enum coverage, foreign-key match rate, date agreement, trailing completeness) plus the domain file's. Personal data: once per job, per the contract. Check: no grain without a measured duplicate count, no join without a match rate.

## 6. Inventory

Fill the grain-and-key inventory in `layering-and-naming.md` in the company's vocabulary: layer, name, one row per, key, sources, decision ids read. Small company, close deadline: the flat default there, decided, shown. Two sources describing one entity: the conformed-entity procedure in `entities-and-time.md`. Check: every table on a question path feeds a model; the rest are listed with a row count and left raw.

## 7. Decision memo

One memo in the contract's shape, grouped by who answers; ask for changes only. Each item is a STATE.md Decisions row with `affects`: `open` until built on its default, then `PROVISIONAL`; an irreversible one is a `[CHECKPOINT]`.

## 8. First slice

Take the first question, its tables only, through [`build-clean-tables.md`](build-clean-tables.md) on the defaults, labelled Draft; widen after the hand-back.

Finished example, a checkpoint with counts:

```
[CHECKPOINT]
Decision: which date ends a subscription for churn.
Context: subscriptions 12,480 rows; canceled_at set on 3,912, ended_at on 3,860; they differ on 214 (5.5%), canceled_at earlier in 209, median gap 31 days.
Options:
  A. ended_at: churn lands the month service stops; revenue counts through the paid period.
  B. canceled_at: churn a month earlier for 209 accounts; August churn 41 becomes 48.
Recommendation: A; the billing system bills to ended_at and finance's sheet matches it.
Action required: reply with a letter or give alternate instructions before this work continues.
```

## Done when

STATE.md holds the discovery, every question verbatim, and every open decision; every table on a question path is counted, profiled, and inventoried; the memo is sent; the first slice is started.

## Reply

The five-part hand-back in `collaboration-contract.md`; under part three: the inventory in their terms, what stays raw with its row count, which question the slice delivers first and when.
