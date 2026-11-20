## Dashcards

A dashboard groups cards (questions, models, metrics) into one layout. Each card on a dashboard is a dashcard: a placement with its own `id`, a position (`row`, `col`) and a size (`size_x`, `size_y`). Dashcards live in the dashboard's `dashcards` array.

## Dashboard parameters (filters)

A dashboard's `parameters` are its filter widgets. Each one is typed: a body with an unknown parameter `type` is refused before it is sent, with an error that lists every allowed type (`string/=`, `string/contains`, `number/between`, `date/range`, `category`, `id`, `temporal-unit`, …).

Parameters are part of the dashboard and have no read command of their own: `mb dashboard get <id> --fields parameters --json` reads them, and `--full` reads the whole record.

An edit replaces the whole `parameters` array, so it is a read-modify-write: read the current set, change it, and send all of it back with `mb dashboard create` or `mb dashboard update <id> --body '{"parameters":[…]}'`. A parameter that the array leaves out is deleted.

Each parameter's `id` is a descriptive string you choose, unique within the dashboard: reuse the `slug`, for example `order_status`. Metabase stores any non-blank string as it is, so you do not need a random id; [mb uuid](uuid.md) makes an opaque one if you want it. A dashcard's `parameter_mappings` bind a parameter to a card's column, and the `parameter_id` of each mapping must match a parameter `id` exactly.

## Card references in dashcards

Before [mb dashboard create](#mb-dashboard-create) or [mb dashboard update](#mb-dashboard-update) sends anything, it reads each card that a positive `card_id` in the body's `dashcards` names, in parallel and once per card. A card that does not exist, is archived, or cannot be read fails this check. The command then writes `{ "ok": false, "errors": [{ "path", "message" }] }` to stdout, with one entry for each dashcard that names such a card and `path` a JSON pointer such as `/dashcards/3/card_id`. It exits 2 with `dashboard card-reference pre-flight failed: N error(s) — fix the dashcard card_id values listed above` on stderr. No dashboard is created or changed, so a stale spec that names an archived or missing card leaves no orphan dashboard.

The check reads live server state, not a bundled schema, so it has no `--skip-validate`: fix the `card_id` values instead.

If the follow-up update with which `mb dashboard create` applies `dashcards` and `tabs` fails (a permission error, a server error, a dropped connection), the error reads `dashboard <id> created but the follow-up update to dashboard <id> failed: <reason>; dashcards not applied`, so you know that the dashboard exists. Send the layout again with `mb dashboard update <id> --body '{"dashcards":[…]}'`, or archive the dashboard with [mb dashboard archive](#mb-dashboard-archive).
