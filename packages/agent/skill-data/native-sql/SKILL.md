---
name: native-sql
description: Author native SQL queries with parameters (filter widgets). Native SQL is a query whose single stage is raw SQL (`mbql.stage/native`) instead of structured MBQL — the same query envelope, so it round-trips. Covers the shape, the four template-tag kinds (raw variable, field filter, snippet, card reference), the variable / optional-block / snippet / card-reference syntax, the field-filter-vs-variable decision, the field ref in a field-filter dimension, wiring a tag to a dashboard filter, and running with values. Triggers — "write a SQL question", "add a filter widget to my SQL", "parameterize this query", "use a field filter", "reference a saved question in SQL", "why does my variable return no rows".
allowed-tools: Read, Write, Edit, AskUserQuestion
---

# Native SQL

**Prefer a structured query.** Native SQL is a Metabase query whose single stage is raw SQL (`mbql.stage/native`) instead of structured MBQL (`mbql.stage/mbql`) — both are the same query envelope (`mbql`). Reach for a native stage only when a structured query genuinely can't express it — engine-specific functions, CTEs, window logic beyond `offset`, hairy hand-tuned SQL — or when the user asks for SQL. If you can write it as a structured stage, do; read the `mbql` skill.

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

This is the form a card stores and returns. You don't hand-assemble the envelope: you give `question_write` a `native` object — `{database_id, sql, template_tags}` — and it builds exactly the above. A saved card **round-trips**: `get_content` with `{items: [{type: "question", id: 12}], include: ["definition"]}` returns this `dataset_query`; take `stages[0].native` and the `template-tags` map, edit the SQL, and send both back through `question_write`'s `native`. A parameterless query needs no `template_tags` — just the SQL.

`question_write` checks the SQL and the tag map against each other before it writes: every `{{tag}}` in the SQL needs a declared entry, and every declared entry needs a `{{tag}}` in the SQL. Nothing checks the **SQL itself** — a syntax error surfaces only when the query runs, so run it with `execute_sql` first.

You may see an older flat form in cards created long ago — `{database, type:"native", native:{query}}`. The server accepts it and normalizes it to the staged form above; a card you re-save through `question_write` comes back staged.

## Parameters are template tags

Every `{{name}}` in the SQL must have a matching entry in `template_tags`, keyed by that name. **The two must agree exactly:** the `{{name}}` in SQL = the map key. Names are case-sensitive (`{{Cat}}` ≠ `{{cat}}`). `question_write` rejects a `{{name}}` with no entry, and an entry with no `{{name}}`.

Four kinds of tag, by `type`:

| Kind               | `type`                           | SQL syntax                    | What it is                                      |
| ------------------ | -------------------------------- | ----------------------------- | ----------------------------------------------- |
| **Raw variable**   | `text` `number` `date` `boolean` | `WHERE total > {{min_total}}` | a literal substituted into the SQL              |
| **Field filter**   | `dimension`                      | `WHERE {{status}}` (bare!)    | a smart filter widget bound to a real column    |
| **Snippet**        | `snippet`                        | `{{snippet: Active Rows}}`    | a reusable SQL fragment (`snippet_write`)       |
| **Card reference** | `card`                           | `{{#42}}` or `{{#42-slug}}`   | another saved query, as a subquery              |

Each tag's `id` and `display-name` are minted for you from the tag name — supply them only to override. Wrap any clause that should be droppable when its value is empty in **`[[ … ]]`**, keyword and all: `[[AND {{status}}]]`, not `AND [[{{status}}]]`. Only one level of nesting; a query using several optional `[[AND …]]` blocks needs a real `WHERE` first (e.g. `WHERE true [[AND {{a}}]] [[AND {{b}}]]`).

## The decision that matters: field filter vs. raw variable

This is the call agents get wrong. Default to a **field filter** whenever the tag filters a real table column.

- A **raw variable** (`{{x}}`) is a dumb literal splice. You write the operator yourself: `WHERE status = {{x}}`. It gives a plain text/number/date box, no dropdown, no date picker, and it's what powers computed bits that aren't a column (`LIMIT {{n}}`, a threshold, an interpolated identifier).
- A **field filter** (`type: dimension`) is a smart widget bound to a column via `dimension`. You write it **bare** — `WHERE {{status}}` — and Metabase expands it to the right SQL (`status IN (...)`, a `BETWEEN` for dates, etc.), driving a dropdown/date-picker sourced from the column's values. Writing `WHERE status = {{status}}` around a field filter **breaks the expansion** — the single most common native-SQL bug.

Field filters only bind to a **real, connected database column** — not an expression, not an aggregate, not a subquery/CTE column. If the thing you're filtering isn't a physical column, it has to be a raw variable.

## Template-tag bodies (the two you author most)

**Field filter** — `dimension` binds a column, `widget-type` picks the widget:

```json
"status": {
  "type": "dimension",
  "dimension": ["field", {}, 141],
  "widget-type": "string/="
}
```

**`dimension` is a field ref: `["field", {options}, <field-id>]`** — options object **second**, id **third**, exactly the `mbql` rule. The legacy `["field", <id>, null]` shape (id first) that the UI and older docs show is not the shape to write here. Send `{}` for the options; the server fills in a `lib/uuid`. The field id comes from `browse_data` — `{action: "get_fields", table_ids: [<table id>]}`.

`widget-type` must suit the column's type and is a closed enum (same vocabulary as dashboard filter `type`): string ops (`string/=`, `string/!=`, `string/contains`, `string/starts-with`, …), number ops (`number/=`, `number/between`, `number/>=`, …), dates (`date/all-options`, `date/range`, `date/relative`, `date/month-year`, …), plus `category`, `id`, `boolean/=`, and the `location/*` set. Text column → a `string/*` or `category`; datetime → a `date/*`; numeric → a `number/*`. `date/all-options` is the most flexible date widget.

**Raw variable** — no `dimension`, no `widget-type`:

```json
"min_total": {
  "type": "number",
  "display-name": "Minimum total",
  "required": true,
  "default": "50"
}
```

Snippet and card-reference bodies (and the full field list for every kind) are in `references/template-tags.md` — load it when you need them.

## Snippets and card references

- **Snippet** (`{{snippet: Name}}`): a shared SQL fragment stored with `snippet_write` — `{method: "create", name: "Active Rows", content: "status = 'active'"}`. `content` is bare SQL, no wrapping, no trailing semicolon. Reuse it across queries; edit it once with `{method: "update", id, content}` and every query picks it up. The tag body carries `snippet-id` + `snippet-name`; get the id from the `snippet_write` result, or from `browse_collection` (`{id: <snippet folder>, type: ["snippet"]}`) — snippets are not in the search index. Read a snippet's `content` with `get_content` at `{items: [{type: "snippet", id}], response_format: "detailed"}`; the concise projection omits it. Snippet names are unique across snippets **including archived ones**, so a name collision can come from a snippet no listing shows you.
- **Card reference** (`{{#42}}`): inlines another saved query as a subquery — `SELECT * FROM {{#42}}` or `WITH x AS {{#42}} …`. The tag body carries `card-id`.
- **Neither takes a parameter value.** A referenced card runs with **its own saved defaults** — you can't override its parameters from the parent query. Snippets are static text. Only raw variables and field filters are user-fillable.

## Iterating on the SQL, then saving it

Run the SQL with `execute_sql` (`{database_id, sql}`) until it returns what you want, then save it with `question_write`. Keep SQL you are iterating on in a `.sql` file: `execute_sql` takes `sql_file` and `question_write`'s `native` takes `sql_file`, so pointing both at the same path saves byte-identically what you ran.

`execute_sql` treats every `{{tag}}` as a **raw variable** and takes its value from `template_tag_values` (`{database_id: 1, sql: "SELECT * FROM orders WHERE id = {{id}}", template_tag_values: {id: 42}}`). It has no field filters, no snippets, no card references — those live in a saved card's `template_tags`. So iterate on the SQL with the filter written out literally (`WHERE status = 'active'`), and swap in the bare `{{status}}` field filter when you hand the SQL to `question_write`:

```json
{
  "method": "create",
  "name": "Active orders by status",
  "display": "table",
  "native": {
    "database_id": 1,
    "sql": "SELECT status, count(*) FROM orders WHERE total > {{min_total}} [[AND {{status}}]] GROUP BY status",
    "template_tags": {
      "min_total": { "type": "number", "display-name": "Minimum total", "default": "0" },
      "status": {
        "type": "dimension",
        "dimension": ["field", {}, 141],
        "widget-type": "string/="
      }
    }
  }
}
```

Then run the saved card end to end with `run_saved_question` — that is the only way to exercise a field filter, a snippet, or a card reference.

## Wiring, defaults, and running

**Give a tag a default** in its own body: `default` supplies the value used when none is passed, `required: true` blocks the run until one is. Metabase derives the card's `parameters` from the template tags, so the widget, its type and its default all follow from the tag.

**Run a saved card with values** through `run_saved_question`, identifying each parameter by `slug` (the tag name) or `id`:

```json
{ "id": 12, "parameters": [{ "slug": "status", "value": "active" }] }
```

Date ranges pass as `"value": ["2024-01-01", "2024-12-31"]`. Omit a parameter entirely to leave its optional (`[[ ]]`) clause out of the SQL. To see what values a filter accepts before you fill it, read the card's parameter ids with `get_content` (`include: ["parameters"]`) and pass one to `get_parameter_values` (`{target: "question", id: 12, parameter_id: "…"}`); `query` narrows to values containing a substring.

**Expose it as a dashboard filter** with `dashboard_write`: declare the parameter in the layout's `parameters`, then map it from the dashcard with `parameter_mappings: [{parameter_id: "status", target_tag: "status"}]` — `target_tag` names the template tag, and the field-filter-vs-variable target is derived from the tag's own type. The dashboard-side mechanics live in the `dashboard` skill.

## Don't

- Don't wrap a field filter in an operator (`WHERE col = {{ff}}`) — write it bare (`WHERE {{ff}}`).
- Don't write the field-filter `dimension` in the legacy `["field", id, null]` shape — use `["field", {}, id]` (options second).
- Don't expect `execute_sql` to expand a field filter, a snippet, or a card reference — save the card and run it with `run_saved_question`.
- Don't use native SQL for DDL or multiple statements — the query is read-only and single-statement; `CREATE`/`UPDATE`/`;`-chained SQL is unsupported. To materialize a table, use a transform (`transform_write`).
- Don't expect `[[ ]]` to save you from a case/type mismatch — `WHERE plan = {{p}}` returns zero rows on a case-sensitive engine if the value's case is off; that's a value problem, not syntax.
- Don't reach for native when a structured query fits — you lose the engine-independence and readability of an `mbql.stage/mbql` stage.
