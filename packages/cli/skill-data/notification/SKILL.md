---
name: notification
description: Alerts, dashboard subscriptions, and notification channels in file mode. Alerts and subscriptions have no YAML representation, so a human creates them in the Metabase UI. Covers what to tell the user, how to prepare a card so an alert on it works, and how to write webhook and email channel YAML in `channels/`. Load when the user asks to "alert me when X drops below Y", "email this dashboard every Monday", "send this to Slack", "set up a subscription", "add a webhook", or edits a Channel YAML file.
allowed-tools: Read, Write, Edit, Bash
---

# Notifications

**You can't create alerts or dashboard subscriptions in file mode.** The representation format has no entity for them, and `mb` has no command for them. A human sets them up in the Metabase UI. You can write the content they deliver, and you can write notification channels.

## Hand alerts and subscriptions to the user

When the user asks for an alert or a subscription:

1. Build or fix the card or dashboard it delivers. Ship it with `mb save`.
2. Tell the user to create the alert or subscription in the Metabase UI. Name the card or dashboard to pick.

Prepare the content so the UI setup works:

- **Alert on a threshold.** A goal alert ("goes above" or "goes below") fires only when the card has a goal line. Set `graph.goal_value` in the card's `visualization_settings` (see `visualization`).
- **Alert on a rare event.** Write the card so it returns rows only when the event happens. The user then picks "when this question has results".
- **Subscription with a filter.** Give the dashboard the filter parameter. The user sets a per-subscription value in the UI (see `dashboard`).

Webhook delivery works for alerts only. A dashboard subscription can't post to a webhook.

## A channel is one YAML file in `channels/`

A channel is a delivery destination that alerts can target. Channels have no `entity_id`: the `name` is the identity. `serdes/meta[0].id` must equal `name`, and `model` is `Channel`.

```
channels/<channel_slug>.yaml
```

Read the schema before you write a channel:

```bash
DIR=$(mb skills path representations --json | jq -r '.data[0].dir')
cat "$DIR/spec/schemas/channel.yaml"
```

`type` is `channel/http` (a webhook) or `channel/email`.

A webhook channel:

```yaml
name: Ops Webhook
description: Posts alert payloads to the ops endpoint
type: channel/http
active: true
details:
  url: https://hooks.example.com/metabase
  method: post
  auth-method: header
  fe-form-type: bearer
  auth-info:
    Authorization: Bearer <token>
serdes/meta:
  - id: Ops Webhook
    model: Channel
```

- `details.url` and `details.auth-method` are required. `auth-method` is `none`, `header`, `query-param`, or `request-body`.
- `auth-info` maps the header or parameter names to their values.
- `details` accepts no other keys.

An email channel holds at most an SMTP `host` and `port`. An admin configures SMTP credentials in Metabase settings. The schema accepts more email keys, but Metabase's own channel schema allows only `host` and `port`.

## Channel footguns

**Warning: `auth-info` values are secrets.** The file goes into git. Ask the user before you write a real token. Otherwise write a placeholder and tell the user to set the value in the UI.

- **The spec's import list omits `channels/`.** The Metabase importer does read `channels/` files. The spec and the importer disagree, so confirm the channel after `mb save` in the Metabase UI.
- **Renaming a channel creates a new channel.** The name is the identity. Keep the name to edit an existing channel.
- **`active: false` detaches the channel.** Metabase removes the channel from every subscription that uses it. It also renames the channel to `DEACTIVATED_<id> <name>`.

## Loop

1. Write or edit the channel file.
2. Run `mb check`. Fix each failure at its JSON path.
3. Run `mb save -m "<what changed>"`.
