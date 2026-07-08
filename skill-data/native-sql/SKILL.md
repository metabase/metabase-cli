---
name: native-sql
description: Author native SQL queries with parameters (filter widgets) for the `mb` CLI. Native SQL is a query whose single stage is raw SQL (`mbql.stage/native`) instead of structured MBQL — the same query envelope, so it is pre-flight-validated and round-trips. Covers the shape, the four template-tag kinds (raw variable, field filter, snippet, card reference), the variable / optional-block / snippet / card-reference syntax, the field-filter-vs-variable decision, the field ref in a field-filter dimension, wiring a tag to a dashboard filter, and running with values. Triggers — "write a SQL question", "add a filter widget to my SQL", "parameterize this query", "use a field filter", "reference a saved question in SQL", "why does my variable return no rows".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Native SQL

**Prefer a structured query.** Native SQL is a Metabase query whose single stage is raw SQL (`mbql.stage/native`) instead of structured MBQL (`mbql.stage/mbql`) — both are the same query envelope (`mbql`). Reach for a native stage only when a structured query genuinely can't express it — engine-specific functions, CTEs, window logic beyond `offset`, hairy hand-tuned SQL — or when the user asks for SQL. If you can write it as a structured stage, do.

General flag conventions, body-input precedence, `./.scratch`, and `mb uuid` mechanics live in `core` (`mb skills get core`).

## The shape

A native `dataset_query` is a query with one **native stage** — the `lib/type: "mbql/query"` envelope, a numeric `database`, and a single `mbql.stage/native` stage carrying the SQL string (`native`) plus a `template-tags` map:

```json
{
  "lib/type": "mbql/query",
  "database": 1,
  "stages": [
    {
      "lib/type": "mbql.stage/native",
      "native": "SELECT count(*) FROM orders WHERE {{status}} AND total > {{min_total}}",
      "template-tags": { "status": { … }, "min_total": { … } }
    }
  ]
}
```

This is the form a card stores and returns — author it. The CLI **pre-flight-validates** it — the envelope, the template-tag shapes, the field refs — through the usual `--print-schema → --dry-run → run` loop (`mbql`), and a saved card **round-trips** in exactly this shape: `mb card get <id> --full --json`, edit the `stages[0].native` string, send it straight back. Only the SQL string is opaque to pre-flight — a **SQL** syntax error surfaces just when you run it, not at `--dry-run`. A parameterless query needs no `template-tags` — just the `native` string.

You may see an older flat form in cards created long ago — `{database, type:"native", native:{query}}`. The server still accepts it (it normalizes to the above) but it skips pre-flight and doesn't round-trip — **don't author it**.

## Parameters are template tags

Every `{{name}}` in the SQL must have a matching entry in the stage's `template-tags`, keyed by that name. **The three must agree exactly:** the `{{name}}` in SQL = the map key = the entry's `"name"` field. Names are case-sensitive (`{{Cat}}` ≠ `{{cat}}`). A `{{name}}` with no entry fails at run time; an unused entry is ignored.

Four kinds of tag, by `type`:

| Kind               | `type`                           | SQL syntax                    | What it is                                   |
| ------------------ | -------------------------------- | ----------------------------- | -------------------------------------------- |
| **Raw variable**   | `text` `number` `date` `boolean` | `WHERE total > {{min_total}}` | a literal substituted into the SQL           |
| **Field filter**   | `dimension`                      | `WHERE {{status}}` (bare!)    | a smart filter widget bound to a real column |
| **Snippet**        | `snippet`                        | `{{snippet: Active Rows}}`    | a reusable SQL fragment (`mb snippet`)       |
| **Card reference** | `card`                           | `{{#42}}` or `{{#42-slug}}`   | another saved query, as a subquery           |

Give each tag an `id` — mint one per tag with `mb uuid` (never hand-write one). Wrap any clause that should be droppable when its value is empty in **`[[ … ]]`**, keyword and all: `[[AND {{status}}]]`, not `AND [[{{status}}]]`. Only one level of nesting; a query using several optional `[[AND …]]` blocks needs a real `WHERE` first (e.g. `WHERE true [[AND {{a}}]] [[AND {{b}}]]`).

## The decision that matters: field filter vs. raw variable

This is the call agents get wrong. Default to a **field filter** whenever the tag filters a real table column.

- A **raw variable** (`{{x}}`) is a dumb literal splice. You write the operator yourself: `WHERE status = {{x}}`. It gives a plain text/number/date box, no dropdown, no date picker, and it's what powers computed bits that aren't a column (`LIMIT {{n}}`, a threshold, an interpolated identifier).
- A **field filter** (`type: dimension`) is a smart widget bound to a column via `dimension`. You write it **bare** — `WHERE {{status}}` — and Metabase expands it to the right SQL (`status IN (...)`, a `BETWEEN` for dates, etc.), driving a dropdown/date-picker sourced from the column's values. Writing `WHERE status = {{status}}` around a field filter **breaks the expansion** — the single most common native-SQL bug.

Field filters only bind to a **real, connected database column** — not an expression, not an aggregate, not a subquery/CTE column. If the thing you're filtering isn't a physical column, it has to be a raw variable.

## Template-tag bodies (the two you author most)

**Field filter** — `dimension` binds a column, `widget-type` picks the widget:

```json
"status": {
  "id": "9ddca4ca-3906-83fd-bc6b-8480ae9ab05e",
  "name": "status",
  "display-name": "Status",
  "type": "dimension",
  "dimension": ["field", {}, 141],
  "widget-type": "string/="
}
```

**`dimension` is a field ref: `["field", {options}, <field-id>]`** — options object **second**, id **third**, exactly the `mbql` rule. The legacy `["field", <id>, null]` shape (id first) that the UI and older docs show is **rejected by pre-flight** here (`must be the field options object`). Send `{}` for the options; the server fills in a `lib/uuid`. The field id comes from `table get <id> --include fields`.

`widget-type` must suit the column's type and is a closed enum (same vocabulary as dashboard filter `type`): string ops (`string/=`, `string/!=`, `string/contains`, `string/starts-with`, …), number ops (`number/=`, `number/between`, `number/>=`, …), dates (`date/all-options`, `date/range`, `date/relative`, `date/month-year`, …), plus `category`, `id`, `boolean/=`, and the `location/*` set. Text column → a `string/*` or `category`; datetime → a `date/*`; numeric → a `number/*`. `date/all-options` is the most flexible date widget.

**Raw variable** — no `dimension`, no `widget-type`:

```json
"min_total": {
  "id": "35f1ecd4-d622-6d14-54be-750c498043cb",
  "name": "min_total",
  "display-name": "Minimum total",
  "type": "number",
  "required": true,
  "default": "50"
}
```

Snippet and card-reference bodies (and the full field list for every kind) are in `references/template-tags.md` — load it when you need them (`mb skills get native-sql --full`).

## Snippets and card references

- **Snippet** (`{{snippet: Name}}`): a shared SQL fragment stored via `mb snippet create --body '{"name":"Active Rows","content":"status = '\''active'\''"}'` — `content` is bare SQL, no wrapping. Reuse it across queries; edit it once. The tag body carries `snippet-id` + `snippet-name`.
- **Card reference** (`{{#42}}`): inlines another saved query as a subquery — `SELECT * FROM {{#42}}` or `WITH x AS {{#42}} …`. The tag body carries `card-id`.
- **Neither takes a parameter value.** A referenced card runs with **its own saved defaults** — you can't override its parameters from the parent query. Snippets are static text. Only raw variables and field filters are user-fillable.

## Wiring, defaults, and running

**Give a tag a default or a dropdown source** by declaring it in the card's `parameters` array (alongside `dataset_query`) — this is where `default`, and a `values_source_type` (`static-list` / `card`) live. Its `target` links back to the tag: `["dimension", ["template-tag", "status"]]` for a field filter, `["variable", ["template-tag", "min_total"]]` for a raw variable. (Metabase auto-derives basic `parameters` from the template tags, so you only declare them to add defaults or a value source.)

**Run a saved card with values** via `card query`, whose `--parameters` is a JSON array of `{type, target, value}` — same `target` grammar:

```bash
mb card query 12 --parameters '[{"type":"string/=","target":["dimension",["template-tag","status"]],"value":"active"}]' --json
```

**Expose it as a dashboard filter** by mapping a dashboard parameter to the tag on the dashcard — the mapping `target` is the same `["dimension",["template-tag","status"]]` (field filter) or `["variable",["template-tag","status"]]` (raw variable). The dashboard-side mechanics (the `parameters` array and `parameter_mappings`) live in `core`.

## Don't

- Don't wrap a field filter in an operator (`WHERE col = {{ff}}`) — write it bare (`WHERE {{ff}}`).
- Don't write the field-filter `dimension` in the legacy `["field", id, null]` shape — use `["field", {}, id]` (options second).
- Don't author the flat `{type:"native", …}` form — send the native stage above.
- Don't use native SQL for DDL or multiple statements — the editor is read-only, single-statement; `CREATE`/`UPDATE`/`;`-chained SQL is unsupported. To materialize a table, use a `transform`.
- Don't expect `[[ ]]` to save you from a case/type mismatch — `WHERE plan = {{p}}` returns zero rows on a case-sensitive engine if the value's case is off; that's a value problem, not syntax.
- Don't reach for native when a structured query fits — you lose the engine-independence and readability of an `mbql.stage/mbql` stage.
