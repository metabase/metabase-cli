---
title: "mb alert"
summary: "Manage Metabase question alerts (scheduled card delivery on a send condition)."
---

# mb alert

Manage Metabase question alerts (scheduled card delivery on a send condition).

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get notification`: send conditions, cron schedules, handlers and recipients, testing a send
- `mb skills get core`: the card an alert watches and how to find its id

## The alert commands read card alerts only

Metabase keeps its internal system-event notifications in the same API as question alerts, with ids alongside theirs. So `get`, `update`, `send` and `archive` refuse (exit 2) an id that names anything other than a card alert: sending one would fire an internal Metabase email.

## mb alert list

List question alerts.

Archived (inactive) alerts are hidden unless you pass --include-inactive. System-event notifications, which share the same API, are never listed here.

```sh
mb alert list [flags]
```

| Flag | Description |
| --- | --- |
| `--card-id <value>` | Only alerts watching this card ID, as `mb card alerts <card-id>` lists them. |
| `--creator-id <value>` | Only alerts created by this user id. |
| `--recipient-id <value>` | Only alerts delivered to this user id. |
| `--include-inactive` | Include archived (inactive) alerts. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb alert list
mb alert list --card-id 94 --json
mb alert list --include-inactive --json
```

## mb alert get

Get a question alert by id.

The compact view holds `id`, `payload_type`, `active`, `creator_id`, the `payload` (`card_id`, `send_condition`, `send_once`), the cron `subscriptions`, and the `handlers` with their recipients. `--full` adds the hydrated card the alert watches.

```sh
mb alert get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Alert id. |

Examples:

```sh
mb alert get 9
mb alert get 9 --full --json
```

## mb alert create

Create a question alert from JSON.

The JSON body needs `payload`, `subscriptions` and `handlers`. `payload` is `{card_id, send_condition, send_once}`, where `send_condition` is `has_result` (the card returns any row), `goal_above` or `goal_below` (both need a goal on the card's visualization).

`subscriptions` is a list of `{cron_schedule}` in Quartz 7-field form (`0 0 8 * * ? *` is daily at 08:00 in the report timezone). `handlers` is a list of `{channel_type: channel/email|channel/slack|channel/http, recipients}`, where each recipient is `{type: "notification-recipient/user", user_id}` or `{type: "notification-recipient/raw-value", details: {value: "a@b.com"}}`.

```sh
mb alert create [flags]
```

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb alert create --body '{"payload":{"card_id":94,"send_condition":"has_result"},"subscriptions":[{"cron_schedule":"0 0 8 * * ? *"}],"handlers":[{"channel_type":"channel/email","recipients":[{"type":"notification-recipient/raw-value","details":{"value":"team@example.com"}}]}]}'
cat alert.json | mb alert create
mb alert create --file alert.json
```

## mb alert update

Update a question alert by id.

Patches only the top-level fields you send: `payload`, `subscriptions`, `handlers` and `active`. Fields inside `payload` merge over the current ones, so `{"payload":{"send_condition":"goal_above"}}` keeps the card, which can't change. `subscriptions` and `handlers` replace the whole list, so send every schedule and recipient you want to keep (`mb alert get <id>` prints them).

The update merges the patch over the alert it reads first, so the alert and its payload keep their IDs. Don't send an `id`: the server reads the body as the alert's whole new state, and a different `id` deletes the alert and inserts a new one.

```sh
mb alert update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Alert id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb alert update 9 --body '{"payload":{"send_condition":"goal_above"}}'
mb alert update 9 --body '{"subscriptions":[{"cron_schedule":"0 0 9 * * ? *"}]}'
mb alert update 9 --body '{"active":true}'
```

## mb alert send

Send a question alert now, off-schedule.

Delivers to every handler on the alert, ignoring its send condition and schedule. Requires the channel to be configured on the server (email needs SMTP set up).

```sh
mb alert send <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Alert id. |

Examples:

```sh
mb alert send 9
mb alert send 9 --json
```

## mb alert archive

Archive a question alert by id, stopping all deliveries.

Deactivates the alert and drops its scheduled trigger. `mb alert list --include-inactive` still shows it, and `mb alert update <id> --body '{"active":true}'` brings it back.

```sh
mb alert archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Alert id. |

Examples:

```sh
mb alert archive 9
mb alert archive 9 --json
```
