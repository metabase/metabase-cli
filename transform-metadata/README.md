# Transform table metadata sync

Pushes **field/table metadata** (descriptions, semantic types, display names) from the
`dbt-models` repo onto the ClickHouse tables created by the migrated **transforms** in
Metabase (database id 2, schemas `transforms_*`).

## Why this lives in a branch (and not git-sync)

Metabase's remote-sync (`stats2-remote-sync`) only serializes **transform definitions and
collections** — *not* data-model table/field metadata. A `mb field update` / `mb table update`
does **not** register as git-sync dirty, so these changes can't be reviewed through the normal
git-sync branch flow. This directory is therefore the reviewable artifact: approve the plan
here, then it gets applied to the instance via the `mb` CLI.

## How the mapping works

- Each transform's table links back to its transform via `transform_id`.
- The transform name equals the dbt model name (e.g. `pylon_ticket`).
- That model's metadata is read from `dbt-models/models/**/schema.{yml,yaml}`:
  - `description` → table / field description
  - `config.meta.metabase.semantic_type` → field semantic type
  - `config.meta.metabase.display_name` → table / field display name

Only **diffs** are emitted: a value already correct on the instance produces no operation,
so `apply.py` is idempotent and re-runnable.

## Files

| File | What |
| --- | --- |
| `plans/<schema>.yaml` | Human-reviewable plan, one file per `transforms_*` schema. Shows each table/field, its current value, and the new value. |
| `apply.jsonl` | The concrete change set — one `mb table/field update` per line. |
| `summary.md` | Stats + the tables with no dbt metadata (skipped) + dbt columns absent on the ClickHouse table. |
| `build_plan.py` | Regenerates `plans/` + `apply.jsonl` from `mb db metadata 2 --full`, `mb transform list`, and the dbt models dir. |
| `apply.py` | Applies `apply.jsonl` via the `mb` CLI. Per-row error handling — a single rejected update is logged and skipped, the run continues. |

## Apply (after approval)

```sh
# regenerate (optional, if the instance or dbt changed):
mb db metadata 2 --profile localhost --json --full --max-bytes 0 > db2_full.json
mb transform list --profile localhost --json > transforms.json
python3 build_plan.py --db-meta db2_full.json --transforms transforms.json \
  --models ../dbt-models/models --out .

# apply:
python3 apply.py --apply apply.jsonl --profile localhost
```

## Notes / decisions

- **Semantic types not overwritten blindly.** Where the migration already set a correct
  semantic type and dbt agrees, no op is produced. Where dbt specifies a type, it wins.
- **Display names** are only set where dbt explicitly declares one (`config.meta.metabase.display_name`),
  not for every auto-titlecased column — avoids churn.
- **One dbt typo normalized:** `type/category` → `type/Category` (Metabase semantic types are
  case-sensitive). Source: `models/data_products/metabase_store/schema.yml`.
- **Undocumented models are skipped**, not blanked — see `summary.md` for the list (github,
  census, etc. have no `schema.yml`).
