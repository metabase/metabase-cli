---
title: "mb subscription"
summary: "Manage Metabase dashboard subscriptions (scheduled dashboard delivery)."
---

# mb subscription

Manage Metabase dashboard subscriptions (scheduled dashboard delivery).

Agent skills:

- `mb skills get notification`: channel schedules, recipients, skip_if_empty, per-subscription filter values
- `mb skills get dashboard`: the dashboard and dashcards a subscription delivers

## mb subscription list

List dashboard subscriptions.

`--full` adds each card's `download_perms`, which `mb subscription get` does not carry.

```sh
mb subscription list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--dashboard-id <value>` |  | Only subscriptions on this dashboard id, as `mb dashboard subscriptions <dashboard-id>` lists them. |
| `--archived` |  | Show archived subscriptions instead of active ones. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema subscription list --output`.

Examples:

```sh
mb subscription list
mb subscription list --dashboard-id 10 --json
mb subscription list --archived --json
```

## mb subscription get

Get a dashboard subscription by id.

The compact view holds `id`, `name`, `dashboard_id`, `collection_id`, `archived`, `skip_if_empty`, the pinned `cards`, and the `channels` with their schedules and recipients. `--full` adds the rest, such as the hydrated `creator` and the entity ids.

```sh
mb subscription get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Subscription id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema subscription get --output`.

Examples:

```sh
mb subscription get 1
mb subscription get 1 --full --json
```

## mb subscription create

Create a dashboard subscription from JSON.

The JSON body needs `name`, `dashboard_id`, `cards`, and `channels`. Each card is `{id, dashboard_card_id, include_csv, include_xls}`, where `id` names the card and `dashboard_card_id` its place on the dashboard — get both ids from `mb dashboard cards <dashboard-id>`. Each channel is `{channel_type: email|slack|http, schedule_type: hourly|daily|weekly|monthly}` plus the fields its schedule needs: `daily` needs `schedule_hour` (0-23); `weekly` also needs `schedule_day` (mon..sun); `monthly` also needs `schedule_frame` (first|mid|last). Email recipients are `[{email: "a@b.com"} | {id: <user-id>}]`; Slack targets a channel via `details: {channel: "#general"}`. A channel is `enabled` unless you say otherwise. Non-empty `parameters` (filter values for this subscription only) need `dashboardSubscriptionFilters` (token dashboard_subscription_filters): a server without it stores them but sends the dashboard's own filter values, so the CLI refuses them there before the request (exit 2).

```sh
mb subscription create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema subscription create`. Output schema: `mb schema subscription create --output`.

Examples:

```sh
mb subscription create --body '{"name":"Weekly orders","dashboard_id":10,"cards":[{"id":94,"dashboard_card_id":87,"include_csv":false,"include_xls":false}],"channels":[{"channel_type":"email","schedule_type":"daily","schedule_hour":8,"recipients":[{"email":"team@example.com"}]}]}'
cat subscription.json | mb subscription create
mb subscription create --file subscription.json
```

## mb subscription update

Update a dashboard subscription by id.

Patches only the fields you send: `name`, `cards`, `channels`, `skip_if_empty`, `parameters`, `archived`. `cards` and `channels` replace the whole list, so send every card and channel you want to keep — `mb subscription get <id> --full` prints the current ones. A subscription's `dashboard_id` and `collection_id` are fixed at creation and cannot be changed. The update reads the subscription first and carries `archived` and `skip_if_empty` forward when the patch leaves them out: the server resets each omitted one to false, so a name-only patch would otherwise un-archive the subscription and clear `skip_if_empty`. Non-empty `parameters` need `dashboardSubscriptionFilters` and are refused before the request without it, as on `mb subscription create`.

```sh
mb subscription update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Subscription id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema subscription update`. Output schema: `mb schema subscription update --output`.

Examples:

```sh
mb subscription update 1 --body '{"name":"Daily orders"}'
mb subscription update 1 --body '{"channels":[{"channel_type":"email","schedule_type":"weekly","schedule_hour":8,"schedule_day":"mon","recipients":[{"email":"team@example.com"}]}]}'
mb subscription update 1 --file patch.json
```

## mb subscription archive

Archive a dashboard subscription by id, stopping all deliveries.

Archiving also disables every channel on the subscription. Metabase has no way to delete a subscription, so archiving is as far as removal goes. Restore it with `mb subscription update <id> --body '{"archived":false}'`, then re-enable its channels.

```sh
mb subscription archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Subscription id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema subscription archive --output`.

Examples:

```sh
mb subscription archive 1
mb subscription archive 1 --json
```
