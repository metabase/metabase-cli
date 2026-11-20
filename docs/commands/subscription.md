---
title: "mb subscription"
summary: "Manage Metabase dashboard subscriptions (scheduled dashboard delivery)."
---

# mb subscription

Manage Metabase dashboard subscriptions (scheduled dashboard delivery).

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get notification`: channel schedules, recipients, skip_if_empty, per-subscription filter values
- `mb skills get dashboard`: the dashboard and dashcards a subscription delivers

## mb subscription list

List dashboard subscriptions.

`--full` adds each card's `download_perms`, which `mb subscription get` doesn't carry.

```sh
mb subscription list [flags]
```

| Flag | Description |
| --- | --- |
| `--dashboard-id <value>` | Only subscriptions on this dashboard ID, as `mb dashboard subscriptions <dashboard-id>` lists them. |
| `--archived` | Show archived subscriptions instead of active ones. |

Also takes the [list](README.md#list-flags) flags.

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

Examples:

```sh
mb subscription get 1
mb subscription get 1 --full --json
```

## mb subscription create

Create a dashboard subscription from JSON.

The JSON body needs `name`, `dashboard_id`, `cards` and `channels`. Each card is `{ id, dashboard_card_id, include_csv, include_xls }`: the card's id and its place on the dashboard, both from `mb dashboard cards <dashboard-id>`.

Each channel is `{ channel_type: email|slack|http, schedule_type: hourly|daily|weekly|monthly }` plus what its schedule needs: `daily` needs `schedule_hour` (0-23), `weekly` also `schedule_day` (mon..sun), and `monthly` also `schedule_frame` (first|mid|last). Email recipients are `[{ email: "a@b.com" } | { id: <user-id> }]`; Slack posts to `details: { channel: "#general" }`. A channel is `enabled` unless you say otherwise.

Non-empty `parameters` (filter values for this subscription only) need `dashboardSubscriptionFilters` (token dashboard_subscription_filters). They're refused (exit 2) on a server without it, which would send the dashboard's own filter values instead.

```sh
mb subscription create [flags]
```

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb subscription create --body '{"name":"Weekly orders","dashboard_id":10,"cards":[{"id":94,"dashboard_card_id":87,"include_csv":false,"include_xls":false}],"channels":[{"channel_type":"email","schedule_type":"daily","schedule_hour":8,"recipients":[{"email":"team@example.com"}]}]}'
cat subscription.json | mb subscription create
mb subscription create --file subscription.json
```

## mb subscription update

Update a dashboard subscription by id.

Patches only the fields you send: `name`, `cards`, `channels`, `skip_if_empty`, `parameters` and `archived`. `cards` and `channels` replace the whole list, so send every card and channel you want to keep (`mb subscription get <id> --full` prints them). `dashboard_id` and `collection_id` can't change after creation.

The update reads the subscription first and keeps its `archived` and `skip_if_empty` when the patch leaves them out, since the server would reset them to `false`. Non-empty `parameters` need `dashboardSubscriptionFilters` and are refused without it, as on `mb subscription create`.

```sh
mb subscription update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Subscription id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb subscription update 1 --body '{"name":"Daily orders"}'
mb subscription update 1 --body '{"channels":[{"channel_type":"email","schedule_type":"weekly","schedule_hour":8,"schedule_day":"mon","recipients":[{"email":"team@example.com"}]}]}'
mb subscription update 1 --file patch.json
```

## mb subscription archive

Archive a dashboard subscription by id, stopping all deliveries.

Archiving also disables every channel on the subscription. Metabase can't delete a subscription, so archiving is as far as removal goes. Restore it with `mb subscription update <id> --body '{"archived":false}'`, then re-enable its channels.

```sh
mb subscription archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Subscription id. |

Examples:

```sh
mb subscription archive 1
mb subscription archive 1 --json
```
