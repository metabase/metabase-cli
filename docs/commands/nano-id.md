---
title: "mb nano-id"
summary: "Mint random NanoIDs, the entity IDs Metabase serializes content by."
---

# mb nano-id

Mint random NanoIDs, the entity IDs Metabase serializes content by.

For the values that must be an entity ID: the `entityId` of a data app's `defineQuery` and `defineAction` definitions. Needs no server.

```sh
mb nano-id [flags]
```

| Flag | Description |
| --- | --- |
| `--count <value>` | How many NanoIDs to mint (default 1, max 10000). Default: `1`. |

Takes the [output](README.md#output-flags) flags.

Agent skills:

- `mb skills get data-app-data`: the entity IDs of a data app's questions and actions

Examples:

```sh
mb nano-id
mb nano-id --count 5
mb nano-id --count 5 --json
```
