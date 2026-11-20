---
title: "mb field"
summary: "Manage Metabase fields."
---

# mb field

Manage Metabase fields.

Agent skills:

- `mb skills get metadata`: semantic types, FK targets, visibility, dropdown behavior

## mb field get

Get a field by id.

`data_sensitivity` is the field's sensitivity label (see `mb field set-sensitivity`), or `null` when it has none. A server older than Metabase 64 has no such label, so the key and the Sensitivity column are left out.

```sh
mb field get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema field get --output`.

Examples:

```sh
mb field get 100
mb field get 100 --json
```

## mb field values

Fetch the cached distinct values for a field (FieldValues list).

Answers `{ values, field_id, has_more_values }`; `values` is empty on a field whose `has_field_values` is `none` or `search`.

```sh
mb field values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema field values --output`.

Examples:

```sh
mb field values 100
mb field values 100 --json
```

## mb field summary

Get the row count and distinct count for a field.

Metabase answers the two counts as an array of pairs; the command answers them as `{ field_id, count, distincts }`.

```sh
mb field summary <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema field summary --output`.

Examples:

```sh
mb field summary 100
mb field summary 100 --json
```

## mb field update

Update a field (description, semantic_type, FK target, visibility, etc.).

A `data_sensitivity` key (a label, or `null` to withdraw one; see `mb field set-sensitivity`) is refused before the request on a server older than Metabase 64 (exit 2), because such a server drops the key without a word.

```sh
mb field update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema field update`. Output schema: `mb schema field update --output`.

Examples:

```sh
mb field update 100 --body '{"description":"customer email","semantic_type":"type/Email"}'
mb field update 100 --file patch.json
cat patch.json | mb field update 100
```

## mb field search

Search a field's values, answering them paired with the values of another field.

Each row is a distinct pair of a value of `<id>` and the value of `<search-id>` on the same warehouse row, ordered by value. A FK on either side is followed to the key it points at, so searching an id column by a name column answers id/name pairs; after that both fields must be on one table, and a pair that is not answers no rows rather than an error, as does any failure of the warehouse query. `--value` keeps the rows whose `<search-id>` value contains it, case-insensitively; without it the first `--limit` rows are answered, so one of the two is required. `label` is null when `<id>` and `<search-id>` resolve to the same field once FKs are followed. A field with custom display values answers every mapped value instead, with its display value as `label`, matching `--value` against the display value and ignoring `<search-id>`. The endpoint takes no offset and reports no count, so `total` is null, every request asks for the rows from the first, at most 1000 at first and twice as many on each request after until the window is covered, and `has_more` is proven by one row fetched past it.

```sh
mb field search <id> <search-id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id whose values are answered. |
| `<search-id>` | Field id whose values are searched. |

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <value>` |  | Max items to return; required without --value (with it, default: as many as fit the output cap). |
| `--offset <value>` | `0` | Start at this item index; pass the previous run's next_offset to continue. |
| `--value <value>` |  | Text the searched values must contain (case-insensitive). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema field search --output`.

Examples:

```sh
mb field search 100 101 --value ada
mb field search 100 101 --value ada --limit 5 --json
mb field search 100 101 --limit 20 --json
```

## mb field remapping

Look up another field's value on the row where a field equals a value.

Answers `{ found: true, value, label }` with `label` the value of `<remapped-id>` on the one row where `<id>` equals `<value>`, or `{ found: false }` when no row does. A FK `<id>` is followed to the key it points at, and `<remapped-id>` must be on that key's table: the server answers a pair that is not, and any failure of the warehouse query, as `{ found: false }` rather than an error. When `<id>` is numeric the server reads the leading number of `<value>` and ignores any text after it (`20abc` looks up 20), failing only a value with no leading number; a value starting with `-` goes after `--` (`mb field remapping 100 101 -- -5`). In text mode the label prints bare so the result composes in a shell; an empty line means either no row matched or the matched label is empty, which `--json` tells apart.

```sh
mb field remapping <id> <remapped-id> <value> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id the value belongs to. |
| `<remapped-id>` | Field id whose value on that row is answered. |
| `<value>` | Value of &lt;id> to look up. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema field remapping --output`.

Examples:

```sh
mb field remapping 100 101 20
mb field remapping 100 101 20 --json
NAME=$(mb field remapping 100 101 20 --format text)
```

## mb field set-sensitivity

Label a field's data sensitivity by hand, or withdraw the label with `none`.

A label set here is a person's call that the server's classifier never overwrites; `none` withdraws it, and the field then shows the label the classifier wrote, if it wrote one, else none. The classifier is off unless the server enables it, and a label it wrote stays after it is switched off. Answers the field with its `data_sensitivity`, which `mb field get <id>` reads back. On a server without `fieldDataSensitivity` the call is refused before the request (exit 2), because such a server drops the label and answers the field as if it had never been sent.

```sh
mb field set-sensitivity <id> <label> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |
| `<label>` | Sensitivity label, most severe first (SEC_KEY \| SYS_TELEMETRY \| PHI \| BIO_GEN \| PCI_FIN \| SENS_PERS \| PII \| CORP_IP \| BIZ_CONF \| PUBLIC), or none to withdraw it. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `fieldDataSensitivity` (v64+).

Output schema: `mb schema field set-sensitivity --output`.

Examples:

```sh
mb field set-sensitivity 100 PII
mb field set-sensitivity 100 none
mb field set-sensitivity 100 PHI --json
```
