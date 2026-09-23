---
name: transform
description: Author Metabase transforms as YAML files. A transform is a query (MBQL or native SQL) or a Python script whose result Metabase writes to a warehouse table. Covers the transform file (source, target, tags, collection), Python transforms and the `common` Python library, transform tags, and transform jobs (cron schedules that run tagged transforms). Transforms run only on their jobs' schedules after `mb save` imports them; the CLI cannot run one. Triggers - "create a transform", "materialize this query as a table", "write a Python transform", "schedule a transform nightly", "add a transform tag", "add a transform job", "why didn't my transform table appear", or editing files under `collections/transforms/`, `transforms/`, or `python_libraries/`.
allowed-tools: Read, Write, Edit, Bash
---

# Transforms

A transform is a YAML file that tells Metabase to run a query or Python script and write the result to a warehouse table. A transform runs only when a transform job with one of its tags fires. The CLI cannot run a transform. Write the files, run `mb check`, then run `mb save`. The job schedule runs the transform.

Load `representations` first for entity_ids, refs, and `serdes/meta`. Load `mbql` or `native-sql` for the query body.

## Four entity types make a scheduled transform

| Entity | File | Schema | Spec section |
| --- | --- | --- | --- |
| Transform | `collections/transforms/<slug>.yaml` | `transform.yaml` | Transform |
| TransformTag | `transforms/transform_tags/<slug>.yaml` | `transform_tag.yaml` | TransformTag |
| TransformJob | `transforms/transform_jobs/<slug>.yaml` | `transform_job.yaml` | TransformJob |
| PythonLibrary | `python_libraries/<path>.yaml` | `python_library.yaml` | PythonLibrary |

The schemas are in `$DIR/spec/schemas/` (see `representations`). A job lists tags. A transform carries tags. The job runs every transform that carries any of its tags.

Read the existing files in `transforms/` before you create a tag or a job. Repos exported from Metabase usually hold the built-in tags (`hourly`, `daily`, `weekly`, `monthly`) and their jobs. Tag the transform with one of those, and you need no new job.

## The transform file holds a source and a target

```yaml
name: Revenue by Category
entity_id: IKFex8lpcj60yHlBmZuJm
creator_id: admin@example.com
source_database_id: Sample Database
description: Order count and revenue per product category
source:
  type: query
  query:
    "lib/type": mbql/query
    database: Sample Database
    stages:
    - "lib/type": mbql.stage/native
      native: |-
        SELECT
          p.CATEGORY,
          COUNT(*) AS order_count,
          SUM(o.TOTAL) AS total_revenue
        FROM ORDERS o
        JOIN PRODUCTS p ON o.PRODUCT_ID = p.ID
        GROUP BY p.CATEGORY
target:
  database: Sample Database
  type: table
  schema: TRANSFORMS
  name: revenue_by_category
tags:
- entity_id: o4ev9uINpMGvyLlsBllvY
  position: 0
  tag_id: dUW7nvQHQBdA0Rx0gJckI   # entity_id of the "daily" TransformTag file
  serdes/meta:
  - id: o4ev9uINpMGvyLlsBllvY
    model: TransformTransformTag
serdes/meta:
- id: IKFex8lpcj60yHlBmZuJm
  label: revenue_by_category
  model: Transform
```

- **Required fields:** `name`, `entity_id`, `creator_id` (a user email), `source_database_id`, `source`, `target`, `serdes/meta`.
- **Use one database name everywhere.** Set `source_database_id`, `source.query.database`, and `target.database` to the same name. A transform writes to the database it reads from.
- **`target.schema` and `target.name` name the output table.** Pick a schema that the Metabase connection can write to. `mb metadata <db-id>` shows the existing schemas. Pick a table name that no other table or transform uses.
- **Set `target.type: table`.** The other value, `table-incremental`, needs a `source-incremental-strategy` object. The spec does not define that object's shape. Copy it from an incremental transform in the repo, or do not use it.
- **Keep SQL multi-line** in a `|-` block scalar. The Metabase editor shows the string as written.
- **Each tag entry is its own entity.** Mint a fresh `entity_id` for each entry, and set `serdes/meta[0].id` to it. Set `tag_id` to the TransformTag's `entity_id`. Number `position` from 0.
- **`collection_id` must name a collection with `namespace: transforms`.** Omit it to put the transform in the root. Never use a regular collection that holds cards and dashboards.
- **Each run replaces the target table.** A non-incremental run drops the table and creates it again. A changed column list is safe.

### An MBQL source must name every aggregation

An MBQL source uses an `mbql.stage/mbql` stage with `source-table` and field refs from `mb metadata`. See `mbql` for clause syntax. The output column names become warehouse column names. Set `name` in each aggregation's options. Otherwise the columns get names like `count` and `sum`.

```yaml
    stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Sample Database, PUBLIC, ORDERS]
      aggregation:
      - - sum
        - name: total_revenue
        - - field
          - base-type: type/Float
          - [Sample Database, PUBLIC, ORDERS, TOTAL]
      breakout:
      - - field
        - temporal-unit: month
        - [Sample Database, PUBLIC, ORDERS, CREATED_AT]
```

### A Python source defines `transform()` and returns one DataFrame

```yaml
source:
  type: python
  source-database: Sample Database
  source-tables:
  - alias: orders
    database_id: Sample Database
    schema: PUBLIC
    table: ORDERS
  body: |-
    import pandas as pd

    def transform(orders):
        return (orders.groupby("USER_ID")
                      .agg(order_count=("ID", "count"))
                      .reset_index())
```

- `transform()` takes one parameter per `source-tables` entry, named by its `alias`. It returns one pandas DataFrame.
- Copy `database_id`, `schema`, and `table` from the table's `ref` in `mb metadata`. For a schemaless database, set `schema: null`. Omit `table_id`.
- Put all source tables and the target in one database.
- Call `.reset_index()` after a `groupby`. Metabase does not write the DataFrame index.
- The script can import only `pandas`, its dependencies (such as `numpy`), and the Python standard library.
- Python runs in memory, one transform at a time. Use a query source for large tables.

### The Python library is shared code named `common`

A PythonLibrary file holds code for every Python transform. Metabase uses one library, with `path: common.py`. Write `import common` in the script and call `common.<function>()`. Library code cannot read warehouse data.

```yaml
entity_id: <mint one>
path: common.py
source: |-
  def cents_to_dollars(series):
      return series / 100
serdes/meta:
- id: <same entity_id>
  model: PythonLibrary
```

If `python_libraries/` already holds the library file, edit it. Do not add a second library file.

## Tags and jobs set the schedule

A TransformTag is a label. A TransformJob holds a cron `schedule` and a `job_tags` list. On each tick, the job runs every transform that carries one of its tags. The job also runs stale upstream transforms that those transforms read from, in dependency order.

To give a transform its own schedule, add a custom tag and a job:

```yaml
# transforms/transform_tags/finance_nightly.yaml
name: finance-nightly
entity_id: VKA9keBbNvGbSlLy0aBu8
serdes/meta:
- id: VKA9keBbNvGbSlLy0aBu8
  label: finance_nightly
  model: TransformTag
```

```yaml
# transforms/transform_jobs/finance_nightly_job.yaml
name: Finance nightly
entity_id: ZvVNMTv1Rnv60HKqkyYGE
description: Runs finance-nightly transforms at 02:00
schedule: 0 0 2 * * ? *
ui_display_type: cron/builder
job_tags:
- entity_id: ngjKVCWXZQyafI5buaeZA
  position: 0
  tag_id: VKA9keBbNvGbSlLy0aBu8
  serdes/meta:
  - id: ngjKVCWXZQyafI5buaeZA
    model: TransformJobTransformTag
serdes/meta:
- id: ZvVNMTv1Rnv60HKqkyYGE
  label: finance_nightly_job
  model: TransformJob
```

- **`schedule` is a Quartz cron string with 7 fields:** second, minute, hour, day-of-month, month, day-of-week, year. Put `?` in day-of-month or day-of-week.
- Cron examples: `0 0 * * * ? *` (hourly), `0 0 0 * * ? *` (daily at midnight), `0 0 0 ? * 1 *` (Sundays). Times use the Metabase server's timezone.
- **Omit `built_in_type` from custom tags and jobs.** Only the four built-in files set it.
- **Do not name a custom tag `hourly`, `daily`, `weekly`, or `monthly`.** Reuse the built-in tag file.
- A transform with no tags never runs. A transform whose tags no job lists never runs.

## You can verify the import, not the run

You can verify these facts:

- `mb check` passes: the files match the schemas.
- `mb save` exits 0: Metabase imported the files.
- After the job's next tick, `mb metadata <db-id>` lists the target table. `mb metadata <db-id> <table-id>` lists its fields.

You cannot verify these facts:

- The SQL or Python runs. `mb check` does not execute the query. A bad column name fails only at run time, in Metabase.
- Run status, run logs, and error messages. Only the Metabase UI shows them.
- The output table before the first scheduled run. Tell the user when the job fires next. If they need the table sooner, ask them to run the transform in the Metabase UI.

Cards and dashboards on the output table need its field refs. Build them after `mb metadata` lists the table. Until then, a native SQL card can query `<schema>.<table>` by name.

## Don't

- Don't put transforms in `collections/main/`. Put them in `collections/transforms/`.
- Don't reuse a tag-association `entity_id` across transforms or jobs.
- Don't expect `mb save` to run the transform. It imports the definition only.
