---
name: representations
description: "The Metabase representation format: the YAML files in the repo that define collections, cards, dashboards, documents, segments, measures, snippets, transforms, and channels. Covers where the full spec and per-entity JSON schemas live on disk, the folder layout, entity keys (entity_id NanoIDs, natural-key refs to databases/tables/fields), serdes/meta, and collection placement. Load before creating or editing any YAML file. Triggers: \"what fields does a card need\", \"where does this file go\", \"how do I reference a table\", \"check says my YAML is invalid\", \"make a new entity_id\"."
allowed-tools: Read, Write, Edit, Bash
---

# Representations

Every piece of Metabase content is one YAML file in the repo. You edit these files directly; `mb check` validates them against the schemas and `mb save` ships them to Metabase. The full specification and the JSON schemas ship with the CLI. Read them from disk, not from memory:

```bash
DIR=$(mb skills path representations --json | jq -r '.data[0].dir')
# $DIR/spec/spec.md                  full format spec (large: read the section you need)
# $DIR/spec/schemas/<entity>.yaml     JSON Schema per entity: card, dashboard, collection, ...
# $DIR/spec/schemas/common/*.yaml     shared defs: query, ref, parameter, temporal_bucketing, ...
```

`spec.md` sections: Entity Keys, Folder Structure, MBQL Query, Native Query, Visualization Settings, Click Behavior, Parameter, then one section per entity (Collection, Card, Dashboard, Document, Segment, Measure, Snippet, Transform). Search it with `grep -n '^## ' "$DIR/spec/spec.md"` and read the section you need.

The fastest way to get a new file right: copy an existing file of the same entity type in the repo, then change it.

## Metabase imports YAML only from six top-level folders

Metabase imports YAML from `collections/`, `databases/**/segments/`, `databases/**/measures/`, `python_libraries/`, `transforms/`, `channels/`, and `metabots/`. It ignores files anywhere else. The spec omits `channels/` and `metabots/`, but the importer reads them and `mb check` validates them.

```
collections/main/<collection_slug>.yaml          collection definition (sibling of its folder)
collections/main/<collection_slug>/<slug>.yaml   cards, dashboards, documents, flat in one folder
collections/snippets/...                         snippets and snippet collections
collections/transforms/<slug>.yaml               transforms
databases/<db>/schemas/<schema>/tables/<table>/segments/<slug>.yaml
databases/<db>/schemas/<schema>/tables/<table>/measures/<slug>.yaml
transforms/transform_jobs/<slug>.yaml            transform jobs
transforms/transform_tags/<slug>.yaml            transform tags
channels/<slug>.yaml                             notification channels
```

**The folder is for humans; `collection_id` is what counts.** An entity lands in the collection named by its `collection_id` (the collection's `entity_id`), whatever folder the file sits in. Omit it and the entity goes to the root collection. A subcollection sets `parent_id`. A card owned by a dashboard sets `dashboard_id` **and** the same `collection_id` as its dashboard.

## Content refs are entity_ids; warehouse refs are names

- **`entity_id`**: a 21-character NanoID (`A-Za-z0-9_-`), unique per entity type. Every new entity needs a fresh one. Never reuse or invent a pattern. Mint one:

  ```bash
  head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9_-' | head -c 21
  ```

- **`serdes/meta`**: the entity's identity path, `[{id: <entity_id>, label: <slug>, model: <Model>}]`. Its `id` must equal `entity_id`.
- **References to other content** use the target's `entity_id` (collection, card, dashboard, document).
- **References to warehouse objects** use natural keys, never numeric ids. Get them from `mb metadata`, whose rows carry a ready-made `ref`:

  | Reference | Format |
  | --- | --- |
  | Database | `"Sample Database"` |
  | Table | `["Sample Database", "PUBLIC", "ORDERS"]` |
  | Field | `["Sample Database", "PUBLIC", "ORDERS", "TOTAL"]` |

  A schemaless database uses `null` for the schema slot.

- **Users** are referenced by email.
- **UUIDs** inside queries and parameters (`lib/uuid`, parameter ids) must be real v4 UUIDs: `uuidgen | tr 'A-Z' 'a-z'`.

## Validate every edit with `mb check` before `mb save`

1. `mb metadata` for the tables and field refs you need (see `core`).
2. Write or edit YAML. Read the entity's schema in `$DIR/spec/schemas/` first.
3. `mb check`, then fix every failure it lists. Each failure names the file, the JSON path, and the schema message.
4. `mb save -m "<what changed>"`.

## Never do these

- Don't put numeric database, table, field, or card ids in YAML. Refs are names and entity_ids.
- Don't rely on the folder to place an entity. Set `collection_id`.
- Don't hand-type entity_ids or UUIDs. Mint them.
- Don't create `cards/` or `dashboards/` subfolders. Entities sit flat in their collection folder.
