---
title: "mb dashboard"
summary: "Manage Metabase dashboards."
---

# mb dashboard

Manage Metabase dashboards.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get dashboard`: wiring filters, linked filters, cross-filtering, click behavior, tabs
- `mb skills get visualization`: dashcard display and visualization_settings
- `mb skills get core`: the 24-column dashcard grid layout

## Dashcards

A dashboard groups cards (questions, models, metrics) into one layout. Each card on a dashboard is a dashcard: a placement with its own `id`, a position (`row`, `col`) and a size (`size_x`, `size_y`). Dashcards live in the dashboard's `dashcards` array.

## Dashboard parameters (filters)

A dashboard's `parameters` are its filter widgets. A body with an unknown parameter `type` is refused before sending, and the error lists every allowed type (`string/=`, `string/contains`, `number/between`, `date/range`, `category`, `id`, `temporal-unit`, …). To read the parameters, run `mb dashboard get <id> --fields parameters --json`.

An edit replaces the whole `parameters` array, so read the current set, change it, and send all of it back with `mb dashboard update <id> --body '{"parameters":[…]}'`. A parameter the array leaves out is deleted.

Each parameter's `id` is any non-blank string you choose, unique within the dashboard, such as its `slug` (`order_status`). It needn't be random, but [mb uuid](uuid.md) makes an opaque one if you want it. A dashcard's `parameter_mappings` bind a parameter to a card's column, and each mapping's `parameter_id` must match a parameter `id` exactly.

## Card references are checked before sending

Before [mb dashboard create](#mb-dashboard-create) or [mb dashboard update](#mb-dashboard-update) sends anything, it reads each card that a positive `card_id` in `dashcards` names. If a card doesn't exist, is archived, or can't be read, nothing is created or changed: the command prints `{ "ok": false, "errors": [{ "path", "message" }] }` on stdout, with one entry for each such dashcard and a `path` like `/dashcards/3/card_id`, and exits 2. To pass the check, fix the `card_id` values. The check reads the server, not a bundled schema, so there's no `--skip-validate`.

If the follow-up update that applies `dashcards` and `tabs` after `mb dashboard create` fails, the error reads `dashboard <id> created but the follow-up update to dashboard <id> failed: <reason>; dashcards not applied`. The dashboard exists: send the layout again with `mb dashboard update <id> --body '{"dashcards":[…]}'`, or archive it with [mb dashboard archive](#mb-dashboard-archive).

## mb dashboard list

List dashboards.

```sh
mb dashboard list [flags]
```

| Flag | Description |
| --- | --- |
| `--filter <value>` | Filter preset: all\|mine\|archived. Default: `all`. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb dashboard list
mb dashboard list --json
mb dashboard list --filter archived --json
```

## mb dashboard get

Get a dashboard by id.

The compact view carries `id`, `name`, `description`, `archived`, `collection_id`, and the `dashcards` and `tabs` in compact form (each dashcard's `id`, `card_id`, tab, position, size and `parameter_mappings`). `--full` returns the whole hydrated dashboard, each dashcard with its card.

```sh
mb dashboard get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Examples:

```sh
mb dashboard get 1
mb dashboard get 1 --json
mb dashboard get 1 --json --full
```

## mb dashboard cards

List dashcards on a dashboard.

```sh
mb dashboard cards <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb dashboard cards 1
mb dashboard cards 1 --json
```

## mb dashboard parameter-values

Fetch the selectable values for a dashboard parameter.

Returns `{ values, has_more_values }`: the parameter's static list, its source card's values, or the distinct values of the field it's mapped to. `--query` keeps only the values that contain the text, ignoring case (up to 1000). `--constraints` sets other parameters' values, by parameter ID, to narrow a parameter linked to them; an array sets several values.

```sh
mb dashboard parameter-values <dashboard-id> <parameter-id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<dashboard-id>` | Dashboard id. |
| `<parameter-id>` | Parameter id (the parameter's id, not its slug). |
| `--query <value>` | Substring to search values for (server-side). |
| `--constraints <value>` | JSON object of other parameters' values by parameter id, narrowing a linked parameter (e.g. '{"a1b2c3":"Gizmo"}'). |

Agent skills:

- `mb skills get dashboard`: dashboard parameters, mapping, value sources

Examples:

```sh
mb dashboard parameter-values 1 order_status --json
mb dashboard parameter-values 1 order_status --query Cam --json
mb dashboard parameter-values 1 product_name --constraints '{"category":["Gizmo","Widget"]}' --json
```

## mb dashboard subscriptions

List subscriptions on a dashboard.

Manage them with `mb subscription create|update|archive`, which take the subscription id printed here.

```sh
mb dashboard subscriptions <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Dashboard id. |
| `--archived` | Show archived subscriptions instead of active ones. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb dashboard subscriptions 10
mb dashboard subscriptions 10 --json
```

## mb dashboard create

Create a dashboard from JSON.

Every dashcard needs a `card_id` (a card ID, or `null` for a virtual card), and a negative dashcard `id` creates a new dashcard. Before anything is sent, each positive `card_id` must name a card you can read that isn't archived. With `dashcards` or `tabs` in the body, a follow-up update applies them, and the command prints the dashboard as that update left it.

```sh
mb dashboard create [flags]
```

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get dashboard`: wiring filters, cross-filtering, click behavior, tabs
- `mb skills get visualization`: dashcard visualization_settings and the 24-column grid

Examples:

```sh
cat dashboard.json | mb dashboard create
mb dashboard create --file dashboard.json
mb dashboard create --body '{"name":"My Dashboard","collection_id":4}'
mb dashboard create --body '{"name":"D","dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

## mb dashboard update

Update a dashboard (and optionally its dashcards/tabs) by id.

Every dashcard needs a `card_id` (a card ID, or `null` for a virtual card), existing ones included, and each positive `card_id` must name a card you can read that isn't archived. `dashcards` and `tabs` each replace the whole list: one the list leaves out is deleted, and a negative `id` creates a new one. With `dashcards` and no `tabs`, the tabs stay, and on a dashboard with several tabs every dashcard needs its `dashboard_tab_id`. To remove all tabs, send `tabs: []` with every `dashboard_tab_id` set to `null`.

```sh
mb dashboard update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get dashboard`: wiring filters, cross-filtering, click behavior, tabs
- `mb skills get visualization`: dashcard visualization_settings and the 24-column grid

Examples:

```sh
cat patch.json | mb dashboard update 1
mb dashboard update 1 --file patch.json
mb dashboard update 1 --body '{"name":"renamed"}'
mb dashboard update 1 --body '{"dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

## mb dashboard update-dashcard

Patch a single dashcard's layout or settings on a dashboard.

Merges the patch into one dashcard and writes the dashboard's dashcards back, with the other dashcards and the tabs unchanged. The patch takes `row`, `col`, `size_x`, `size_y`, `dashboard_tab_id`, `parameter_mappings`, `inline_parameters`, `visualization_settings` and `series`; an empty patch or any other key is refused before sending. Prints the updated dashcard.

```sh
mb dashboard update-dashcard <dashboard-id> <dashcard-id> [flags]
```

| Argument | Description |
| --- | --- |
| `<dashboard-id>` | Dashboard id. |
| `<dashcard-id>` | Dashcard id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb dashboard update-dashcard 1 5 --body '{"row":2,"col":0}'
mb dashboard update-dashcard 1 5 --body '{"size_x":12,"size_y":4}'
cat patch.json | mb dashboard update-dashcard 1 5
```

## mb dashboard copy

Copy a dashboard, with its tabs and dashcards, into a collection.

The copy references the source cards; `--deep` duplicates its questions and metrics into the target collection instead, and keeps referencing its models. A dashboard with dashboard questions (cards saved in the dashboard) needs `--deep`. Without `--collection-id`, the copy goes to the root collection, and in the source's own collection a duplicated card's name ends in " - Duplicate", in your Metabase language. Archived cards and cards you can't read are left out, with their dashcard when they're its main card, and listed by ID in `uncopied`, once for each dashcard they were on. Action, link and placeholder dashcards aren't copied.

```sh
mb dashboard copy <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Dashboard id. |
| `--name <value>` | Name for the copy (default: the source name). |
| `--collection-id <value>` | Collection to copy into (default: root). |
| `--collection-position <value>` | Pin the copy at this position in the collection. |
| `--description <value>` | Description for the copy (default: the source description). |
| `--deep` | Duplicate the questions and metrics instead of referencing them. |

Examples:

```sh
mb dashboard copy 1
mb dashboard copy 1 --deep --collection-id 4 --name "Orders (copy)" --json
```

## mb dashboard verify

Mark a dashboard verified, or withdraw the mark with --remove.

Records a moderation review on the dashboard (admins only). Verified content has a check mark in Metabase and ranks higher in search; `mb search --verified` finds only verified content. `--remove` records a review with no status, which withdraws the mark. `dashboard get <id> --fields moderation_reviews` reads the reviews, newest first, and the first one's `status` (`verified` or `null`) is the current state.

```sh
mb dashboard verify <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Dashboard id. |
| `--text <value>` | Note stored with the review. |
| `--remove` | Withdraw the verification instead of granting it. |

Needs `contentVerification` (token content_verification).

Examples:

```sh
mb dashboard verify 1
mb dashboard verify 1 --text "Reviewed the joins" --json
mb dashboard verify 1 --remove
```

## mb dashboard archive

Archive (soft-delete) a dashboard by id.

Sets `archived: true`. The dashboard stays readable through `dashboard list --filter archived` and `dashboard get <id>`; `mb dashboard update <id> --body '{"archived":false}'` restores it.

```sh
mb dashboard archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Examples:

```sh
mb dashboard archive 1
mb dashboard archive 1 --json
```
