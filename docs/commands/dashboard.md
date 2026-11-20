---
title: "mb dashboard"
summary: "Manage Metabase dashboards."
---

# mb dashboard

Manage Metabase dashboards.

Agent skills:

- `mb skills get dashboard`: wiring filters, linked filters, cross-filtering, click behavior, tabs
- `mb skills get visualization`: dashcard display and visualization_settings
- `mb skills get core`: the 24-column dashcard grid layout

## mb dashboard list

List dashboards.

```sh
mb dashboard list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--filter <value>` | `all` | Filter preset: all\|mine\|archived. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard list --output`.

Examples:

```sh
mb dashboard list
mb dashboard list --json
mb dashboard list --filter archived --json
```

## mb dashboard get

Get a dashboard by id.

```sh
mb dashboard get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard get --output`.

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

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard cards --output`.

Examples:

```sh
mb dashboard cards 1
mb dashboard cards 1 --json
```

## mb dashboard parameter-values

Fetch the selectable values for a dashboard parameter.

Reads the chain-filter value endpoint. With --query the server returns only values containing the substring (first 1000 matches). --constraints sets other parameters' values, by parameter id, which narrow the values of a parameter linked to them; an array sets several values.

```sh
mb dashboard parameter-values <dashboard-id> <parameter-id> [flags]
```

| Argument | Description |
| --- | --- |
| `<dashboard-id>` | Dashboard id. |
| `<parameter-id>` | Parameter id (the parameter's id, not its slug). |

| Flag | Default | Description |
| --- | --- | --- |
| `--query <value>` |  | Substring to search values for (server-side). |
| `--constraints <value>` |  | JSON object of other parameters' values by parameter id, narrowing a linked parameter (e.g. '{"a1b2c3":"Gizmo"}'). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard parameter-values --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--archived` |  | Show archived subscriptions instead of active ones. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard subscriptions --output`.

Examples:

```sh
mb dashboard subscriptions 10
mb dashboard subscriptions 10 --json
```

## mb dashboard create

Create a dashboard from JSON.

Every dashcard must include card_id (a card id, or null for a virtual card). Any positive card_id is pre-flight-validated (exists and readable, not archived) before the dashboard is created.

```sh
mb dashboard create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema dashboard create`. Output schema: `mb schema dashboard create --output`.

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

Every dashcard must include card_id (a card id, or null for a virtual card). Any positive card_id is pre-flight-validated (exists and readable, not archived) before the PUT. dashcards and tabs each replace the whole list. A body with dashcards and no tabs keeps the current tabs, and on a dashboard with several tabs every dashcard then needs its dashboard_tab_id. Send tabs to change them, or [] with every dashboard_tab_id null to remove them all.

```sh
mb dashboard update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema dashboard update`. Output schema: `mb schema dashboard update --output`.

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

```sh
mb dashboard update-dashcard <dashboard-id> <dashcard-id> [flags]
```

| Argument | Description |
| --- | --- |
| `<dashboard-id>` | Dashboard id. |
| `<dashcard-id>` | Dashcard id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema dashboard update-dashcard`. Output schema: `mb schema dashboard update-dashcard --output`.

Examples:

```sh
mb dashboard update-dashcard 1 5 --body '{"row":2,"col":0}'
mb dashboard update-dashcard 1 5 --body '{"size_x":12,"size_y":4}'
cat patch.json | mb dashboard update-dashcard 1 5
```

## mb dashboard copy

Copy a dashboard, with its tabs and dashcards, into a collection.

The copy references the source cards; --deep duplicates its questions and metrics into the target collection instead and keeps referencing its models. A dashboard holding dashboard questions must be copied with --deep. Copied into the source dashboard's own collection, a duplicated card's name gets the suffix " - Duplicate", translated into your Metabase language. Without --collection-id the copy lands in the root collection. Archived cards, cards you cannot read, and every card on a dashcard whose main card you cannot read are left out and listed by id as `uncopied`, once per dashcard they sat on. A left-out main card takes its dashcard with it; a left-out series card stays on a dashcard whose main card is referenced and is dropped from one whose main card is duplicated. Action, link and placeholder dashcards are not copied.

```sh
mb dashboard copy <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--name <value>` |  | Name for the copy (default: the source name). |
| `--collection-id <value>` |  | Collection to copy into (default: root). |
| `--collection-position <value>` |  | Pin the copy at this position in the collection. |
| `--description <value>` |  | Description for the copy (default: the source description). |
| `--deep` |  | Duplicate the questions and metrics instead of referencing them. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard copy --output`.

Examples:

```sh
mb dashboard copy 1
mb dashboard copy 1 --deep --collection-id 4 --name "Orders (copy)" --json
```

## mb dashboard verify

Mark a dashboard verified, or withdraw the mark with --remove.

Records a moderation review on the dashboard (admins only). Verified content carries a check mark in the product and ranks higher in search. Each call adds a review and makes it the dashboard's most recent one; `--remove` records a review with no status, which withdraws the verification. `--text` stores a note with the review. `dashboard get <id> --fields moderation_reviews` reads the reviews, newest first. Prints the review.

```sh
mb dashboard verify <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--text <value>` |  | Note stored with the review. |
| `--remove` |  | Withdraw the verification instead of granting it. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `contentVerification` (token content_verification).

Output schema: `mb schema dashboard verify --output`.

Examples:

```sh
mb dashboard verify 1
mb dashboard verify 1 --text "Reviewed the joins" --json
mb dashboard verify 1 --remove
```

## mb dashboard archive

Archive (soft-delete) a dashboard by id.

```sh
mb dashboard archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Dashboard id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema dashboard archive --output`.

Examples:

```sh
mb dashboard archive 1
mb dashboard archive 1 --json
```
