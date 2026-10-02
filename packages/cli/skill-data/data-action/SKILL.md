---
name: data-action
description: Author and run Metabase data actions with the `mb` CLI — saved, parameterized native SQL writes (INSERT, UPDATE, DELETE) filed in a collection and run with values. Covers enabling them on a database, the body, mapping template tags to parameters, running, and the lifecycle. Triggers — "add a data action", "let users update a row", "a button that inserts a record", "run a write query", "a form that saves to the database", "delete rows from Metabase".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataActionsWithoutModel]
---

# Data actions

A **data action** is one native SQL statement that writes — `INSERT`, `UPDATE` or `DELETE` — with named inputs. It lives in a collection, and dashboards, apps and `mb data-action execute` run it with values.

Flag conventions and `./.scratch` are in `core`; the native query and its template tags follow `native-sql`. This skill covers what a data action adds.

## Check the database first

Data actions are off on every database until an admin turns on **Model actions** for it (Admin → Databases → the database). `mb` cannot change that setting.

```bash
mb db get <id> --full --json
```

- `features` must contain `"actions"` — otherwise the driver cannot run writes; pick another database.
- `settings["database-enable-actions"]` must be `true`. If it is not, ask the user to have an admin enable it. Create and execute fail with `Actions are not enabled.` until then.

## The body

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
            "id": "order_id",
            "name": "order_id",
            "display-name": "Order ID",
            "type": "number",
            "required": true
          },
          "note": {
            "id": "note",
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

- `type` is always `"query"`. Never set `model_id` or `type: "implicit"`; `mb data-action create` refuses both.
- `database_id` and `dataset_query.database` are the same id (`mb db list`). Omit `collection_id` for the root collection (`mb collection list`).
- One statement, no `;`. `create` and `update` validate `dataset_query` as `native-sql` does.

## Parameters: one per template tag

Each `{{name}}` needs a `template-tags` entry and a `parameters` entry, all using the same name:

| Tag `type` | Parameter `type` |
| ---------- | ---------------- |
| `number`   | `number/=`       |
| `text`     | `string/=`       |
| `date`     | `date/single`    |
| `boolean`  | `boolean/=`      |

- Parameter `id` and `slug` are the tag name; `target` is `["variable", ["template-tag", "<name>"]]`.
- Use raw variables only. A field filter (`type: "dimension"`), snippet or card reference does not work in a write — write the comparison yourself (`WHERE id = {{order_id}}`).
- Set `required: true` on every input the statement cannot run without (`WHERE` keys, `NOT NULL` columns).
- Wrap an optional input in `[[ … ]]` with `required: false`; the clause drops out when no value is given. This makes one action do partial updates: `UPDATE orders SET updated_at = now() [[, note = {{note}}]] [[, status = {{status}}]] WHERE id = {{order_id}}`.

## Run it

```bash
mb data-action execute <id> --body '{"parameters":{"order_id":1042,"note":"rush delivery"}}'
```

`parameters` is keyed by parameter `id`. The result is `{"rows-affected": <n>}`. A missing required value is refused. A run cannot be undone, so confirm with the user before running against data that matters, and test a new action on a row created for the purpose.

## Lifecycle

| Task                     | Command                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Find                     | `mb data-action list` (unarchived only), `mb search --models action <text>`              |
| Inspect                  | `mb data-action get <id> --full --json`                                                  |
| Change SQL, inputs, name | `mb data-action update <id> --file patch.json` (changed fields only)                     |
| Move                     | `mb data-action update <id> --body '{"collection_id":<id>}'`                             |
| Archive / restore        | `mb data-action archive <id>` / `mb data-action update <id> --body '{"archived":false}'` |
| Delete                   | `mb data-action delete <id> --yes` (also removes the dashboard buttons that run it)      |

Archiving or deleting a collection archives or deletes its data actions. Existing model-bound or implicit data actions still list, run and archive; leave them as they are.

## Don't

- Don't create a model for a data action.
- Don't concatenate values into the SQL; every value goes through a template tag.
- Don't run a data action on production data without the user's go-ahead.
