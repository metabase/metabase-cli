---
title: "mb uuid"
summary: "Mint random UUID v4 strings."
---

# mb uuid

Mint random UUID v4 strings.

Use them where a value must be a UUID: the `lib/uuid` of an aggregation that an MBQL aggregation ref points at, and a document node's `_id`. The MBQL pre-flight rejects a hand-written placeholder (`a1`, `uuid-1`) in a `lib/uuid`. Text output prints one UUID per line, JSON a string array. A `--count` outside 1 through 10000 exits 2.

```sh
mb uuid [flags]
```

| Flag | Description |
| --- | --- |
| `--count <value>` | How many UUIDs to mint (default 1, max 10000). Default: `1`. |

Takes the [output](README.md#output-flags) flags.

Agent skills:

- `mb skills get mbql`: aggregation refs
- `mb skills get document`: document node ids

Examples:

```sh
mb uuid
mb uuid --count 5
mb uuid --count 5 --json
mb uuid --count 5 --format text
U=$(mb uuid --format text)
```
