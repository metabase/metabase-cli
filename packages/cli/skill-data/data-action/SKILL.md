---
name: data-action
description: Author and run Metabase data actions with the `mb` CLI — saved, parameterized native SQL writes (INSERT, UPDATE, DELETE), or implicit actions that insert, update or delete one row of a table, filed in a collection and run with values. Covers enabling them on a database, the collection they go in, the body, mapping template tags to parameters, table actions, running, and the lifecycle. Triggers — "add a data action", "let users update a row", "a button that inserts a record", "run a write query", "a form that saves to the database", "delete rows from Metabase". Inside a data app, start with `data-app-actions`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataActionsWithoutModel]
---

# Data actions

A **data action** writes to a database with named inputs. A **query action** is one native SQL statement — `INSERT`, `UPDATE` or `DELETE`. An **implicit action** inserts, updates or deletes one row of a table, with the table's columns as its inputs (_Table actions_). Either lives in a collection, and dashboards, apps and `mb data-action execute` run it with values.

Flag conventions and `./.scratch` are in `core`; the native query and its template tags follow `native-sql`. This skill covers what a data action adds.

## Check the database first

Data actions are off on every database until an admin turns on **Data actions** for it ("Allow data actions that use this database to be run", Admin → Databases → the database). That toggle is the database setting `database-enable-actions`.

```bash
mb db get <id> --full --json
```

- `features` must contain `"actions"` — otherwise the driver cannot run writes; pick another database.
- `settings["database-enable-actions"]` must be `true`. Create and execute fail with `Actions are not enabled.` until then. An admin profile turns it on with `mb db set-data-actions <id> true`; anyone else asks an admin to. Turning it on lets anyone with access to the database's actions write to it, so confirm with the user first.

## Pick the collection

A data action goes in a data actions collection, a data app collection, or the data actions root (omit `collection_id`). A regular collection is refused with `An action without a model can only go in a data actions or data app collection.` Make one with:

```bash
mb collection create --namespace data-actions --body '{"name":"Order actions"}' --json
```

## The body

Mint one template-tag `id` per tag with `mb uuid --count <n> --format text`.

```json
{
  "name": "Set order note",
  "type": "query",
  "database_id": 1,
  "collection_id": 12,
  "dataset_query": {
    "lib/type": "mbql/query",
    "database": 1,
    "stages": [
      {
        "lib/type": "mbql.stage/native",
        "native": "UPDATE orders SET note = {{note}} WHERE id = {{order_id}}",
        "template-tags": {
          "order_id": {
            "id": "6f1c9a4e-2b7d-4e0a-9c3f-1d2e3f4a5b6c",
            "name": "order_id",
            "display-name": "Order ID",
            "type": "number",
            "required": true
          },
          "note": {
            "id": "0b8d7c6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e",
            "name": "note",
            "display-name": "Note",
            "type": "text",
            "required": true
          }
        }
      }
    ]
  },
  "parameters": [
    {
      "id": "order_id",
      "slug": "order_id",
      "name": "Order ID",
      "type": "number/=",
      "target": ["variable", ["template-tag", "order_id"]],
      "required": true
    },
    {
      "id": "note",
      "slug": "note",
      "name": "Note",
      "type": "string/=",
      "target": ["variable", ["template-tag", "note"]],
      "required": true
    }
  ]
}
```

- `type` is `"query"` here; `"implicit"` is _Table actions_. Never set `model_id`; `mb data-action create` refuses it.
- `database_id` and `dataset_query.database` are the same id (`mb db list`). `collection_id` is the data actions collection (here `12`); omit it for the data actions root.
- A template tag's `id` is a UUID, unique among the tags: the representation schema requires one.
- One statement, no `;`. `create` and `update` validate `dataset_query` as `native-sql` does.

## Parameters: one per template tag

Each `{{name}}` needs a `template-tags` entry and a `parameters` entry, all using the same name:

| Tag `type` | Parameter `type` |
| ---------- | ---------------- |
| `number`   | `number/=`       |
| `text`     | `string/=`       |
| `date`     | `date/single`    |
| `boolean`  | `boolean/=`      |

- Parameter `id` and `slug` are the tag name (not the tag's UUID `id`); `target` is `["variable", ["template-tag", "<name>"]]`.
- Use raw variables only. A field filter (`type: "dimension"`), snippet or card reference does not work in a write — write the comparison yourself (`WHERE id = {{order_id}}`).
- Set `required: true` on every input the statement cannot run without (`WHERE` keys, `NOT NULL` columns).
- Wrap an optional input in `[[ … ]]` with `required: false`; the clause drops out when no value is given. This makes one action do partial updates: `UPDATE orders SET updated_at = now() [[, note = {{note}}]] [[, status = {{status}}]] WHERE id = {{order_id}}`.

## Table actions

For a plain insert, update or delete of one row, make an implicit action on the table instead of writing SQL:

```json
{
  "name": "Add customer",
  "type": "implicit",
  "kind": "row/create",
  "table_id": 7,
  "collection_id": 12
}
```

- `kind` is `row/create`, `row/update` or `row/delete`. `table_id` comes from `mb table list --db-id <id>`.
- The table needs exactly one primary key; otherwise create is refused.
- Its parameters are the table's columns, without sensitive and retired ones, under the column names; read them with `mb data-action get <id> --full --json`. Update and delete pick the row by the primary key parameter; update changes only the columns given.
- No `database_id`, `dataset_query` or `parameters` in the body. Hide an input with `visualization_settings.fields.<column>.hidden`.
- Change `kind` or `table_id` later with `mb data-action update`.

## Run it

```bash
mb data-action execute <id> --body '{"parameters":{"order_id":1042,"note":"rush delivery"}}'
```

`parameters` is keyed by parameter `id`. A query action answers `{"rows-affected": <n>}`; an implicit one `{"rows-updated": 1}`, `{"rows-deleted": 1}`, or `{"created-row": {...}}` with the new row's primary key and the columns it was given. A missing required value is refused. A run cannot be undone, so confirm with the user before running against data that matters, and test a new action on a row created for the purpose.

## Lifecycle

| Task                     | Command                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Find                     | `mb data-action list` (unarchived only), `mb search --models action <text>`              |
| Inspect                  | `mb data-action get <id> --full --json`                                                  |
| Change SQL, inputs, name | `mb data-action update <id> --file patch.json` (changed fields only)                     |
| Move                     | `mb data-action update <id> --body '{"collection_id":<id>}'`                             |
| Archive / restore        | `mb data-action archive <id>` / `mb data-action update <id> --body '{"archived":false}'` |
| Delete                   | `mb data-action delete <id> --yes` (also removes the dashboard buttons that run it)      |

Archiving or deleting a collection archives or deletes its data actions. Existing data actions of a model still list, run and archive; leave them as they are.

## Don't

- Don't create a model for a data action.
- Don't concatenate values into the SQL; every value goes through a template tag.
- Don't run a data action on production data without the user's go-ahead.
