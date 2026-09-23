# Build clean tables

Applies: an approved inventory, or one model added later (skip to step 3, add its Models row, tag it into the job), or one case a transform gets wrong (steps 4 and 5 on that model). Produces transform files on the branch, their rules pinned by transform tests, gated, kept out of the Library until final, scheduled, with a standing check card.

Checklist (copy into TodoWrite; a resumed session reads the todo list and STATE.md first): `1 pre-flight` `2 collections, tag, job` `3.<model> build` `4.<model> test` `5.<model> gate` `6.<table> metadata` `7 job, check` `8 change` `reply`.

Read first: [`layering-and-naming.md`](../references/layering-and-naming.md), [`transform-tests.md`](../references/transform-tests.md), [`data-quality-checks.md`](../references/data-quality-checks.md), and the domain file STATE.md names. File mechanics: `mb skills get transform`.

## Commands you will run

```bash
source ./.scratch/probe.sh                                   # q(): references/state.md
mb entity-id --count 3                                       # entity_id for each new file
q "SELECT * FROM (<model sql, slice predicate on>) t LIMIT 5" # pass: status completed
mb validate collections/transforms transforms                # the files you changed
git add -A collections transforms && git commit -m "<model>: <what and why>" && git push
mb git-sync import --branch "$BRANCH" --json                 # waits; a failure names the file and field
EID=<the transform's entity_id>
ID=$(mb eid --model transform "$EID" --json | jq -r --arg e "$EID" '.entity_ids[$e].id')
mb transform-test create --file ./.scratch/<m>.test.json --json | jq '{id,name}'   # body: references/transform-tests.md
mb transform-test run <test-id> --json | jq '{status, failed: [.expectations[] | select(.status != "passed") | {name, status, "missing-rows", "extra-rows", "cell-mismatches", sample}]}'   # exit 1 unless passed
mb transform-test update <test-id> --file ./.scratch/<m>.test.json   # inputs and expectations replace whole
mb transform-test list --transform-id $ID --fields id,name --json    # every test on a model
mb transform run $ID --sync --json | jq '{status:.final.status, table:.target_table_id, msg:.final.message}'
grep -rl '<schema>.<name>' collections/transforms                    # dependents, in the files
```

A transform file (the full shape in `mb skills get transform`), SQL in a block scalar:

```yaml
name: mart_billing_fct_customer_month
description: <the five facts and constants, below>
entity_id: <mb entity-id>
creator_id: <STATE.md creator>
source_database_id: <database name>
collection_id: <layer collection entity_id>
source:
  type: query
  query:
    "lib/type": mbql/query
    database: <database name>
    stages:
      - "lib/type": mbql.stage/native
        native: |-
          <the model SQL, header comment first>
target:
  {
    type: table,
    database: <database name>,
    schema: <out_schema>,
    name: mart_billing_fct_customer_month,
  }
tags:
  - entity_id: <mb entity-id>
    tag_id: <the chain's tag entity_id>
    position: 0
    serdes/meta:
      - { id: <that association entity_id>, model: TransformTransformTag }
serdes/meta:
  - { id: <the transform entity_id>, label: mart_billing_fct_customer_month, model: Transform }
```

## 1. Pre-flight

Read STATE.md; confirm its tables exist (`mb table list --db-id $DB --fields id,name,schema`) and that the branch is checked out and pushed. Prove the write path once: a transform file `_rde_smoke` (one literal row into `out_schema`) through the whole loop, validate, commit, import, `run --sync`. A permission, missing-schema, or import error is a `[CHECKPOINT]` for the admin. Then remove the file, commit and import again; the smoke table itself stays until the user drops it, so name it in the hand-back.

## 2. Collections, tag, job, rows

Reuse what exists (the files under `collections/transforms/` and `transforms/`); else one collection file per layer (`namespace: transforms`, under `collections/transforms/`), one tag file per chain, one job file over the tag at the loader's cadence (ask when data lands; default daily after, `[DECIDED, reversible]`). `entity_id`s into STATE.md; one Models row per model in dependency order, `cfg_<domain>` first when a constant exists. Materialization: `layering-and-naming.md`.

## 3. Build loop, one model at a time

SQL in `./.scratch/<m>.sql` while iterating; the description carries the five facts plus every constant per `layering-and-naming.md`, mirrored in the SQL header. Raw-table blocks: `staging-rules.md`; staging is a CTE unless shared or expensive. Validate on a slice (a bounded predicate on the driving table) through `q` until the shape and the step 5 checks pass; drop the predicate, write the SQL into the transform file; alias every source table and qualify columns by the alias (step 4 needs it). Validate, commit, import, then step 4; on green, `run --sync`. `table: null`: `mb transform get $ID --fields target_table_id`. A failed run: fix the file, validate, commit, import, run again; unreadable: `mb skills get transform`, "Iterating on a failing transform". MBQL source: prove the query with `mb query --dry-run` and a run in the run form, then write the file form (`mb skills get mbql`, "From the run form to the file form").

## 4. Test

For a model that carries a rule (every intermediate and final-layer model; a staging block only when it deduplicates or converts): one test body in `./.scratch/<m>.test.json` per `transform-tests.md`, with the transform's numeric id, one input per table the SQL reads (`cfg_<domain>` included), one expectation per rule in the header's Definition and Caveats and per `[DECIDED, reversible]` on the model; the domain file's cases. `transform-test create`, then `run`: red is fixed in the transform file, imported, run again; the fixture changes only when it was wrong, and the hand-back says so. On green write `tests` in the Models row (`3 pass`) and go to step 5; the model does not materialise on red. A model with nothing to test writes `tests: none` with the reason. When the instance refuses `mb transform-test`: `tests: unavailable`, the `q()` fallback in `transform-tests.md`.

## 5. Gate

The eight checks as one query per `data-quality-checks.md`, at its cadence. A FAIL stops the chain. Judgment calls (`modeling-decisions.md`) are `[DECIDED, reversible]` from the profile, `[CHECKPOINT]` when irreversible; a decision taken here gets its case added to the step 4 test. Write the Checks and Models rows. Raw, staging, and intermediate tables stay out of the Library; the picker's curated surface is what is published.

## 6. Metadata on final-layer tables

Per table, in the order `semantic-layer-design.md` gives: publish it to the Library once its gate passes (`mb library publish --table-ids <id>`, a `[CHECKPOINT]` when it is canonical), then set its metadata where `mb skills get metadata` says it lives, bodies in [`build-semantic-layer.md`](build-semantic-layer.md). Under time pressure stop after keys, foreign keys, currency, and hidden plumbing columns, and say what remains.

## 7. Schedule, run once, leave a check

`mb transform-job transforms <job id>` lists every model; `mb transform-job run <job id>`, then `mb transform runs` until none is `started`: every member `succeeded`. Per layer, the standing check card as a file in the data-quality collection (body in `data-quality-checks.md`, Checks that outlive the build), imported and run once with `mb card query`. An alert on it is set in Metabase; ask the owner to add one, and name the card in the hand-back.

## 8. Change a deployed model

Copy the SQL to `./.scratch/<m>.prev.sql`; the branch history is the rollback. Run the model's tests as they stand (`transform-test list --transform-id $ID`, then `run` each): a green baseline, or a finding to report before touching anything. Add the case that motivated the change as a fixture row and its expectation, see it fail. Classify: logic only, edit and run; shape change, the table must be dropped before the run (`mb skills get transform`, "Iterating on a failing transform"); rename, re-point every definition and card file on the old column, and every expectation that names it. Edit the file, validate, commit, import; run the tests; an expectation the changed rule moved is updated in the same step and its old and new rows go in the hand-back, never deleted (a test that has to go is a `[CHECKPOINT]`). Then find dependents in the transform files, run their tests, run the job, re-gate each rebuilt table, re-verify their definitions per `semantic-layer-design.md`, record the change on the description and in the commit, restate per the contract.

Finished example, a transform description (the SQL header mirrors it):

```
One row per customer per month (key: customer_id, period_month). Sources: int_billing_invoice_line_spread, cfg_billing. Definition: recognized recurring revenue per customer per month from spread invoice lines; state new/retained/lapsed/reactivated by the gap rule. Caveats: USD only; one-off charges flagged, not removed; newest month flagged incomplete. Constants: cfg_billing.gap_months = 1 (D7, open); cfg_billing.last_complete_period = 2026-08.
```

## Done when

Every Models row has its file, `entity_id`, `transform_id`, `table_id`, rows, `tests` (a pass count, `none` with a reason, or `unavailable`), no FAIL; every file is committed, pushed and imported; the job ran once, every member `succeeded`; only final-layer tables published; metadata done or its stop stated; the check card exists and its alert is requested; STATE.md `next` is empty.

## Reply

The five-part hand-back in `collaboration-contract.md`; part one links `$MB_URL/data-studio/transforms/<id>/inspect` and names the branch; under part three: what one row of each table is, the constants decided, the tests per model (count and the cases they pin) and the checks and counts.
