# State

Every playbook reads and writes here.

## STATE.md

`./.scratch/STATE.md`, this schema:

```markdown
# STATE

branch: rde/billing # the session's branch, the one every import names
db_id: 3
database: Warehouse # the name files reference it by
engine: <from mb db get>
raw_schema: raw_billing
out_schema: analytics
layers: stg, int, mart # theirs, or the default
collections: stg=<eid> int=<eid> mart=<eid> analytics=<eid> drafts=<eid> dq=<eid>
library: data=12 metrics=13 # or: unavailable
tag: rde_billing=<eid> job: <eid> (id 4)
creator: jo@acme.example # the creator_id every new file carries
autonomy: balanced # owner of definitions: <who>
domain: subscription-revenue # or none
stage: build-clean-tables
next: model 8 of 15, blocked on D7
last_complete_period: 2026-08 # max(event_at)=09-11, ratio 0.31

## Models

| model | file | entity_id | transform_id | table_id | rows | tests | gate | note |

## Decisions

| id | decision | answer | by | date | status | affects |
| D7 | churn gap, months | 1 | CEO | | PROVISIONAL | churn metric |

## Questions

| question (verbatim) | metric | home table, time column | definitional filter | breakouts (own, or FK to entity.column) | exists or build | status |

## Checks

| model | dup_key | null_required | cast | rows | grain | non_negative | period_flag | enum |
```

Status: `open`, `PROVISIONAL` (default in use), `decided`. Record each the moment it is known.

## Where state lives

- A fact about a model (five header facts, constants): the transform's description; the SQL header mirrors it ([layering-and-naming.md](layering-and-naming.md)).
- A fact about a number: the metric's or segment's description.
- A definition change or data incident: a dated `Changed <date>:` line on the definition's description, and the commit that made it.
- Decisions and check results: those tables; `open` or `PROVISIONAL` holds its `affects` at `Draft` ([collaboration-contract.md](collaboration-contract.md)).
- An exclusion: a row in `dim_exclusion_rule` (predicate, entity, reason, source, source-enforced) plus a flagged column with a reason, never a `WHERE`.

Nothing is written twice. Collections, tags and jobs are recorded by `entity_id`, what files reference; transforms and tables also by numeric id, what commands take. Deployed means: its file committed on the branch and imported (or landed outside Metabase); its transform tests pass (`tests` is a pass count, or `none` with a reason, or `unavailable` when the instance refuses `mb transform-test`; [transform-tests.md](transform-tests.md)); last run succeeded; rows above zero or a confirmed empty result; no FAIL in Checks.

## Resume

`cat ./.scratch/STATE.md` first. If it exists: use its branch, ids and autonomy without asking; `git status` and `git log --oneline -10` show what is committed, `mb git-sync status --json` which branch the instance holds, and `mb transform list --fields id,name,description,target --json` confirms its models; continue at `stage` and `next`; copy the playbook checklist into TodoWrite, ticking done steps. If not, create it once the database is known; the owner question fills `autonomy`.

## The probe helper

Written once, sourced every session (`DB` from STATE.md):

```bash
cat > ./.scratch/probe.sh <<'SH'
q() { jq -n --arg q "$1" --argjson db "$DB" '{"lib/type":"mbql/query",database:$db,stages:[{"lib/type":"mbql.stage/native",native:$q}]}' | mb query --file - --json | jq -c '{status, error, cols: [.data.cols[]?.name], rows: .data.rows}'; }
SH
source ./.scratch/probe.sh
```

`q "SELECT count(*) FROM raw.orders"` is one call. Pass: `status == "completed"`; else read `error`, or stderr when output is empty.

Browser links are `$MB_URL` plus the object's path (`/question/<id>`, `/dashboard/<id>`, `/data-studio/transforms/<id>`).
