---
title: "mb uuid"
summary: "Mint random UUID v4 strings."
---

# mb uuid

Mint random UUID v4 strings.

For the values that must be a UUID: the `lib/uuid` of an aggregation an MBQL aggregation ref points at, and a document node's `_id`.

```sh
mb uuid [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--count <value>` | `1` | How many UUIDs to mint (default 1, max 10000). |

Shared flags: [output](README.md#output-flags).

Output schema: `mb schema uuid --output`.

Agent skills:

- `mb skills get mbql`: aggregation refs
- `mb skills get document`: document node ids

Examples:

```sh
mb uuid
mb uuid --count 5
mb uuid --count 5 --json
U=$(mb uuid --format text)
```
