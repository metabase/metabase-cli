---
title: "mb nano-id"
summary: "Mint random NanoIDs, the entity IDs Metabase serializes content by."
---

# mb nano-id

Mint random NanoIDs, the entity IDs Metabase serializes content by.

For the values that must be an entity ID: the `entityId` of a data app's `defineQuery` and `defineAction` definitions.

```sh
mb nano-id [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--count <value>` | `1` | How many NanoIDs to mint (default 1, max 10000). |

Shared flags: [output](README.md#output-flags).

Output schema: `mb schema nano-id --output`.

Agent skills:

- `mb skills get data-app-data`: the entity IDs of a data app's questions and actions

Examples:

```sh
mb nano-id
mb nano-id --count 5
mb nano-id --count 5 --json
```
