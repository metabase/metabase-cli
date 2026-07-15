---
name: notification
description: Scheduled delivery of Metabase content by email, Slack, or webhook — question alerts (`mb alert …`, one card, fires on a send condition) and dashboard subscriptions (`mb subscription …`, one dashboard, fires on a schedule). Covers choosing between them, the two different schedule and recipient contracts, channel prerequisites, and testing a delivery. Load when the user wants to "alert me when X drops below Y", "email this dashboard every Monday", "send this question to Slack", "set up a subscription", "who gets this report", "add a recipient", "stop these emails", "post to a webhook when the number spikes", or anything `mb alert …` / `mb subscription …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# notification (alerts & subscriptions)

Metabase delivers content on a schedule two different ways, and they share almost nothing under the hood:

|            | `mb alert`                                           | `mb subscription`                           |
| ---------- | ---------------------------------------------------- | ------------------------------------------- |
| Delivers   | one **card**                                         | one **dashboard** (selected dashcards)      |
| Fires      | on a **send condition** each time the schedule ticks | every time the schedule ticks               |
| Schedule   | one **cron string**                                  | structured `schedule_type` + hour/day/frame |
| Channels   | `channel/email`, `channel/slack`, `channel/http`     | `email`, `slack`, `http`                    |
| Recipients | typed union (`user` / `group` / `raw-value`)         | `{id}` or `{email}`                         |
| API        | `/api/notification`                                  | `/api/pulse`                                |

Pick by **what is being delivered**, not by how often. A user asking to "get emailed when signups drop below 100" wants an alert (a condition on one card). A user asking to "email the exec dashboard every Monday" wants a subscription. If they want a whole dashboard _conditionally_, there is no such thing — the closest is a subscription with `skip_if_empty`, or an alert on the one card that carries the condition.

Because the two bodies look superficially alike and are not, **never adapt one body shape into the other by hand.** Authoring a subscription's `schedule_type` inside an alert (or a `cron_schedule` inside a subscription) fails or, worse, silently drops the schedule.

## Before you create anything: is the channel configured?

A delivery to an unconfigured channel is accepted by the server and then never sends. This is the single most common "it doesn't work" report, and nothing in the create response hints at it. Check first:

```bash
mb setting get 'email-configured?'   --profile <n> --json | jq .value   # → true if SMTP is set up
mb setting get 'slack-token-valid?'  --profile <n> --json | jq .value   # → true if the Slack app is connected
```

Quote the key — the trailing `?` is a shell glob character and an unquoted `email-configured?` will not reach the CLI.

`false` means an **admin** must configure SMTP or the Slack app in Metabase before any delivery works. Say so and stop; do not create a notification that silently goes nowhere. Slack has a second trap: to post to a **private** channel, someone must invite the Metabase app to that channel (`@Metabase` in the channel) — it will not appear as a target until then.

## Alerts (`mb alert`)

An alert body has exactly three parts:

```json
{
  "payload": { "card_id": 94, "send_condition": "has_result", "send_once": false },
  "subscriptions": [{ "cron_schedule": "0 0 8 * * ? *" }],
  "handlers": [
    {
      "channel_type": "channel/email",
      "recipients": [
        { "type": "notification-recipient/raw-value", "details": { "value": "team@example.com" } }
      ]
    }
  ]
}
```

**`send_condition`** is the whole point of an alert:

| Value                       | Fires when                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `has_result`                | the card returns **any** row. The rare-event pattern: write the card so it returns rows _only_ when the thing you care about happened, then alert on `has_result`. |
| `goal_above` / `goal_below` | the result crosses the card's goal line.                                                                                                                           |

`goal_above` / `goal_below` **require a goal already set on the card's visualization** (`visualization_settings.graph.goal_value` — see the `visualization` skill). Without one the alert can never fire, and the failure is silent. Check with `mb card get <id> --fields visualization_settings --json` before choosing a goal condition; if there's no goal, either set one or reshape the card so `has_result` expresses the condition.

`send_once: true` fires the alert at most once and then deactivates it — a one-shot "tell me when this finally happens."

**`cron_schedule`** is a 7-field **Quartz** expression (`sec min hour day-of-month month day-of-week year`), not the 5-field Unix cron most people know. `0 0 8 * * ? *` is "every day at 08:00". The `?` in the day-of-week slot means "unspecified" and is mandatory when day-of-month is set (Quartz rejects `*` in both). The hour is evaluated in the **instance's report timezone**, not UTC and not yours — read it with `mb setting get report-timezone --json`, and say which zone you scheduled in when you report back to the user.

**`handlers`** carry the delivery. The `channel_type` values are prefixed (`channel/email`, not `email` — that prefix is the subscription spelling). Recipients are a typed union:

```text
{ "type": "notification-recipient/user",      "user_id": 3 }                       a Metabase user
{ "type": "notification-recipient/group",     "permissions_group_id": 5 }          everyone in a group
{ "type": "notification-recipient/raw-value", "details": { "value": "a@b.com" } }  an external address
```

`channel/http` is a **webhook**, and it is alerts-only — dashboard subscriptions cannot post to a webhook. It needs a webhook channel configured server-side; pass its id as `channel_id`.

**Verbs.** `mb alert list` hides archived alerts unless you pass `--include-inactive`; `mb card alerts <card-id>` is the same list scoped to one card. `mb alert archive <id>` deactivates (`active: false`) and stops delivery — it is not a delete, and `mb alert update <id> --body '{"active":true}'` brings it back. `mb alert send <id>` delivers **immediately**, ignoring both the schedule and the send condition — that's your end-to-end test that the channel really works. It sends to real recipients, so test with yourself as the only recipient first.

## Subscriptions (`mb subscription`)

```json
{
  "name": "Weekly orders",
  "dashboard_id": 10,
  "cards": [{ "id": 94, "dashboard_card_id": 87, "include_csv": false, "include_xls": false }],
  "channels": [
    {
      "channel_type": "email",
      "schedule_type": "weekly",
      "schedule_hour": 8,
      "schedule_day": "mon",
      "recipients": [{ "email": "team@example.com" }]
    }
  ]
}
```

**Each card needs two different ids.** `id` is the card id; `dashboard_card_id` is the id of the _placement_ of that card on that dashboard. Both come from `mb dashboard cards <dashboard-id> --json` — take them from the same row. Passing the card id in both slots is the most common subscription bug; it produces a subscription that sends the wrong content or nothing.

**The schedule fields required depend on `schedule_type`:**

| `schedule_type` | Also required                                                 | Meaning                                                                                                                                        |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `hourly`        | —                                                             | every hour                                                                                                                                     |
| `daily`         | `schedule_hour` (0–23)                                        | every day at that hour                                                                                                                         |
| `weekly`        | `schedule_hour` + `schedule_day` (`mon`…`sun`)                | that weekday                                                                                                                                   |
| `monthly`       | `schedule_hour` + `schedule_frame` (`first` / `mid` / `last`) | that point in the month. With `first` / `last` you may add `schedule_day` to mean e.g. "first Monday"; with `mid` a `schedule_day` is rejected |

Recipients are `{"email": "a@b.com"}` for an external address or `{"id": <user-id>}` for a Metabase user. A Slack channel is **not** a recipient — it goes in `details`: `{"channel_type": "slack", "details": {"channel": "#general"}, …}`.

**`skip_if_empty: true`** suppresses the send when the dashboard's questions return no rows — the way to build a "only tell me when something happened" dashboard report. **`parameters`** sets filter values for this subscription only, so one dashboard can feed several audiences a different slice (Pro/Enterprise). Its entries are dashboard parameter values — the parameter `id`s come from `mb dashboard get <id> --fields parameters --json` (see the `dashboard` skill).

`mb subscription list --archived` is a **swap, not a union** — it returns archived subscriptions _instead of_ active ones, never both. `mb dashboard subscriptions <id>` is the list scoped to one dashboard. `mb subscription archive <id>` also disables every channel on it, so restoring takes two steps: `update --body '{"archived":false}'`, then re-send the `channels` array with `enabled: true`.

## Updating: the lists replace wholesale

On both nouns, the collection-valued fields are **replaced**, not merged:

- alert — `subscriptions` and `handlers`
- subscription — `cards` and `channels`

So "add a recipient" is a read-modify-write, never a patch:

```bash
mb alert get 9 --json > ./.scratch/alert.json     # read the current handlers
# edit ./.scratch/alert.json — add the recipient to the existing handlers array
mb alert update 9 --body "$(jq -c '{handlers}' ./.scratch/alert.json)"
```

Sending a partial `handlers` array **deletes the recipients you left out.** The same holds for a subscription's `channels`: omit a channel and it's gone.

Scalar fields _do_ merge, and inside an alert so does `payload` — `mb alert update 9 --body '{"payload":{"send_condition":"goal_above"}}'` keeps the card. An alert's `card_id` and a subscription's `dashboard_id` are fixed at creation; to point at different content, create a new one and archive the old.

(Drive updates through `mb alert update` / `mb subscription update` only. Both endpoints have destructive raw-PUT semantics — the notification PUT is a spec-diff that will delete and recreate the row under a new id if the ids don't match, and the pulse PUT re-applies server defaults to omitted keys, silently un-archiving. The CLI's update verbs read-merge-write to neutralize both. A hand-rolled `curl` PUT will not.)

## End-to-end recipe

1. **Confirm the channel works** — `mb setting get 'email-configured?'` / `'slack-token-valid?'`. Stop and ask for an admin if `false`.
2. **Find the content id.** Alert: the card id (`mb card list`, `mb search`). Subscription: the dashboard id _and_ the `{id, dashboard_card_id}` pairs from `mb dashboard cards <id> --json`.
3. **Check the condition is expressible.** Goal alert → the card must have a goal. Otherwise reshape toward `has_result`.
4. **Confirm the recipients with the user before creating.** A wrong address means real mail to a real person, and the fix is a full read-modify-write.
5. **Create** from a file in `./.scratch` (see `core` for body input).
6. **Test the delivery** — `mb alert send <id>`. There is no equivalent for subscriptions; verify those by reading back `mb subscription get <id>` and waiting for the schedule.
7. **Report the schedule in the instance's timezone**, not the user's assumed one.

## Don't

- Don't create a notification against an unconfigured channel and call it done — it will never send, and nothing errors.
- Don't set a `goal_above` / `goal_below` alert on a card with no goal line.
- Don't reuse the card id as `dashboard_card_id`.
- Don't send a partial `handlers` / `channels` / `cards` / `subscriptions` array — you will delete the entries you omitted.
- Don't use `mb alert send` to "check it looks right" on an alert with real recipients — it emails all of them, immediately. To preview the content, run the card itself (`mb card query <card-id>`), which delivers nothing. To rehearse the delivery, create the alert with yourself as the only recipient, `mb alert send` it, then add the real recipients via the read-modify-write above.
- Don't mix the spellings: `channel/email` is an alert, `email` is a subscription.

Cross-links: `core` (auth, `--json`, body input), `dashboard` (dashcards and the `parameters` a subscription can override), `visualization` (the `graph.goal_value` a goal alert depends on).
