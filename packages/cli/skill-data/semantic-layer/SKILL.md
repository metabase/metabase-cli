---
name: semantic-layer
description: Build Metabase's semantic layer with the `mb` CLI — models, metrics, measures, and segments — what each one is, which verb creates/updates/archives it, the single-table reach rule, where each surfaces for the person using Metabase, and publishing the trusted set to the Library. Use for "save this as a metric", "make a reusable filter", "add a segment / measure to this table", "turn this question into a model", "define MRR / active customers officially", "publish these tables to the Library", "why doesn't my segment show up".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Semantic layer

Metabase's semantic layer is four kinds of saved definition plus the Library that marks the trusted ones. Each has its own CLI noun, its own home, and its own place in the product.

| Shape       | What it is                   | Bound to       | Create with                        | The user meets it in                             |
| ----------- | ---------------------------- | -------------- | ---------------------------------- | ------------------------------------------------ |
| **Model**   | A curated starting table     | a collection   | `mb card create` `"type":"model"`  | the data picker's **Models**; as a query source  |
| **Metric**  | An official, reusable number | a collection   | `mb card create` `"type":"metric"` | browse/search **Metrics**; as a source, dashcard |
| **Measure** | A reusable aggregation       | one `table_id` | `mb measure create`                | the **Summarize** block on that table            |
| **Segment** | A reusable row filter        | one `table_id` | `mb segment create`                | the **Filter** block on that table               |

Version floors: segments are v58+, measures and the Library v59+, and the Library also needs the EE `library` token feature. Flag conventions, body input, and `./.scratch` come from `core` (`mb skills get core`); every `definition` / `dataset_query` body is `mbql`'s subject, and what a column _means_ (semantic types, FK targets) is `metadata`'s.

## Single-table reach decides where a definition can live

A segment or measure reaches **exactly one table**. It appears only on a question built _directly_ on that table — not through a join, not on a question built on another question, not on a model derived from it. A metric is bound the same way to whatever its `dataset_query` names.

The consequence is structural: definitions belong on **wide, clean tables**. If one needs facts from two tables, widen the table first with a transform (`mb skills get transform`), run it with `--sync` so Metabase registers the output table, then define on that table's id. A segment built against a narrow normalized table silently never shows up where the user looks.

## Create

Segment and measure bodies share three keys — `name`, `table_id`, and a flat MBQL `definition` (a filter clause for a segment, **exactly one** aggregation for a measure). An MBQL 5 `definition` is checked against the bundled JSON Schema before it is sent; fix what it reports rather than reaching for `--skip-validate`.

```bash
mb segment create --body '{
  "name": "Active customers",
  "description": "Ordered in the last 90 days",
  "table_id": 42,
  "definition": { ... }
}' --profile <n> --json

mb measure create --file ./.scratch/net-revenue.json --profile <n> --json
```

Metrics and models are cards, so they take the full card body — `name`, `type`, `dataset_query`, `display`, `visualization_settings` (`{}` is fine), and the `collection_id` that files them:

```bash
mb card create --body '{
  "name": "Monthly recurring revenue",
  "type": "metric",
  "collection_id": 7,
  "display": "scalar",
  "dataset_query": { ... },
  "visualization_settings": {}
}' --profile <n> --json
```

`display` is required even for a metric — `scalar` for a headline number, `line` when it carries a time dimension people will chart. A temporal breakout in the metric's `dataset_query` is its default time dimension: opening the metric charts it by that column.

Docs: <https://www.metabase.com/docs/latest/data-studio/segments>, <https://www.metabase.com/docs/latest/data-studio/measures>, <https://www.metabase.com/docs/latest/data-modeling/metrics>.

## Change and retire

- `mb segment update <id>` and `mb measure update <id>` are partial updates — send only what changes — and **require a non-blank `revision_message`**, which lands in the audit log. `mb segment archive <id>` / `mb measure archive <id>` default the message to `"Archived via mb CLI"`; override with `--revision-message "<why>"`.
- `mb card update <id>` patches a metric or model; `mb card archive <id>` retires it, `mb card update <id> --body '{"archived":false}'` brings it back.
- **Iterate with `update`, never delete-and-recreate.** Saved questions and dashcards reference these by id; a new id leaves them pointing at nothing. Archive is the only retirement for all four — nothing here hard-deletes.

## Name it for the menu, describe it for the machine

The **name** is what someone reads in a dropdown six weeks from now with no memory of how it was built: `Active customers (ordered in last 90 days)`, not `active_seg_v2`. Keep the set consistent — same casing, same noun order.

The **description** is the text Metabase's search and its AI features read to decide whether a definition answers a question. Write one full sentence saying what it counts or selects and what it deliberately excludes. Every `create` body above takes `description`; a definition without one is invisible to everything that ranks by meaning.

## Publish the trusted set to the Library

The Library says "start from these" to both people and agents — the canonical marker for a finished semantic layer. Tables published to its **Data** collection appear first in every data picker and rank up in search; metrics saved into its **Metrics** collection are prioritized in nav, search, and the query builder.

```bash
mb library create --profile <n> --json                        # idempotent; returns Data/Metrics collection ids
mb library publish --table-ids 42,43 --profile <n> --json     # resolves the Data collection itself, creating the Library if absent
mb library get --profile <n> --json
```

Publish cascades to upstream FK dependencies; `mb library unpublish` cascades to downstream dependents. Both need **admin or data-analyst** — Curate alone is not enough — and fail with HTTP 403 (exit 1) without write _and_ query permission on every affected table. Publish status reads back on the table: `mb table get <id> --json` carries `is_published`. On a remote-sync instance, `mb git-sync add-collection <data-collection-id>` makes exports carry the published metadata.

## Verify every definition three ways

Nothing here fails loudly when it lands in the wrong place:

1. **It runs and the number is plausible.** Query through the definition (a metric with `mb card query <id> --json`, a segment or measure inside an ad-hoc `mb query` body) and read the result — a count matching nothing you expect is a wrong definition, not a rendering problem.
2. **It is attached to what you meant.** `mb segment list --json` / `mb measure list --json` report `table_id`; `mb card get <id> --fields id,name,type,collection_id --json` reports a metric's or model's home and type. A metric created without `type` is a plain question and will never appear under Metrics.
3. **It surfaces where a person looks.** `mb search "<name>" --models segment,measure,metric,dataset --json` confirms it is findable (`dataset` is search's name for a model); the table above says which block of the query builder it belongs in.

## Don't

- Don't weld a row filter into a measure. A measure aggregates what it is given; conditional arithmetic belongs in the formula (`SumIf` / `CountIf`), and row selection belongs in a segment the user combines at question time. A welded-in filter collides with the one they apply on top.
- Don't build the semantic layer on raw normalized tables — single-table reach makes those definitions unusable. Widen with a transform first.
- Don't expect a segment or measure to follow the data into a joined question, a nested question, or a model built on its table. It stays on its own table.
- Don't update a segment or measure without `revision_message` — the call is rejected, and the CLI does not synthesize one.
- Don't publish half-built tables to the Library. Publishing is a claim that people should start there.
