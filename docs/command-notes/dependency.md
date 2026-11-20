Metabase records an edge from every card, dashboard, document, snippet, transform, sandbox, segment, measure or action to what it reads (a table, a card, a snippet, a transform's output), and analyses each dependent's query for errors traced back to what it reads. From Metabase v60 a background job recomputes the graph shortly after content changes, so a freshly saved query can take a few seconds to appear.

## Rows

Every row is `{ id, type, data }` plus, where the command reports it, `dependents_count`: a map from usage kind (`question`, `model`, `metric`, `dashboard`, `document`, `transform`, …) to how many entities depend on the row directly, or `null` when nothing does.

`data` names and places the entity by kind:

- A table carries `name`, `display_name`, `db_id`, `schema` and its `db` (`{ id, name }`).
- A card carries `name`, `type` (`question`, `model` or `metric`), `database_id`, `view_count` and its `collection`, plus the `dashboard` or `document` it lives inside, when it does.
- A dashboard or document carries its `view_count` and `collection`; a snippet its `collection`; an action its `type` (`query` or `implicit`) and `collection`.
- A segment, measure or sandbox carries its `table` (`{ id, name, display_name }`).
- A transform carries its `name` and `description` only, with `table` always `null`.

The compact projection keeps those; `--full` adds the heavier hydrations: a table's `fields`, a card's `result_metadata`, creators, last-edit info.

## Locations

An entity's location is what `--query` matches besides its name, what `--sort-column location` orders by, and what the text table shows: the dashboard, document or collection holding a card, a table's database, a segment's or measure's table, and the collection of a snippet, dashboard, document or action. A sandbox has none; `unreferenced` and `breaking` sort it by its id.

A transform's row carries no collection. `unreferenced` and `breaking`, which match and sort on the server, use its collection's name (`Transforms` for one at the root), while `dependents`, `broken` and the text table give it no location.

## Archived and dropped content

From Metabase v63 `graph` includes archived upstream entities; older servers leave them out. `dependents`, `broken` and `unreferenced` leave archived cards, dashboards, documents, snippets, actions, segments and measures out on every server.

From v63 `unreferenced` and `breaking` also keep dropped and hidden tables, and `breaking` keeps archived sources, so a dropped table or an archived card that broke its dependents is reported. Older servers leave all of these out, and only an `archived` parameter the newer ones dropped would bring them back, so the CLI does not offer it.
