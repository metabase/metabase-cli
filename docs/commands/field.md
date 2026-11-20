---
title: "mb field"
summary: "Manage Metabase fields."
---

# mb field

Manage Metabase fields.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get metadata`: semantic types, FK targets, visibility, dropdown behavior

## mb field get

Get a field by id.

`data_sensitivity` is the field's sensitivity label (see `mb field set-sensitivity`), or `null` when it has none. On a server without `fieldDataSensitivity` (v64+), the key and the Sensitivity column are left out.

```sh
mb field get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Examples:

```sh
mb field get 100
mb field get 100 --json
```

## mb field values

Fetch the cached distinct values for a field (FieldValues list).

Returns `{ values, field_id, has_more_values }`; `values` is empty on a field whose `has_field_values` is `none` or `search`.

```sh
mb field values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Examples:

```sh
mb field values 100
mb field values 100 --json
```

## mb field summary

Get the row count and distinct count for a field.

Metabase returns the two counts as an array of pairs; the command returns them as `{ field_id, count, distincts }`.

```sh
mb field summary <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Examples:

```sh
mb field summary 100
mb field summary 100 --json
```

## mb field update

Update a field (description, semantic_type, FK target, visibility, etc.).

A `data_sensitivity` key (a label, or `null` to withdraw one; see `mb field set-sensitivity`) is refused before the request (exit 2) on a server without `fieldDataSensitivity` (v64+).

```sh
mb field update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb field update 100 --body '{"description":"customer email","semantic_type":"type/Email"}'
mb field update 100 --file patch.json
cat patch.json | mb field update 100
```

## mb field search

Search a field's values, answering them paired with the values of another field.

Returns distinct pairs of a value of `<id>` and the value of `<search-id>` on the same warehouse row, ordered by value. A FK on either side is followed to the key it points at, so you can search an id column by a name column; after that, both fields must be on one table. A pair that isn't, or a failed warehouse query, returns no rows rather than an error. Pass `--value` to keep the rows whose `<search-id>` value contains it (case-insensitive), or `--limit` to take the first rows; one of the two is required. `label` is `null` when both resolve to the same field. A field with custom display values returns every mapped value instead, with its display value as `label`, and matches `--value` against that. `total` is always `null`.

```sh
mb field search <id> <search-id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Field id whose values are answered. |
| `<search-id>` | Field id whose values are searched. |
| `--limit <value>` | Max items to return; required without --value (with it, default: as many as fit the output cap). |
| `--offset <value>` | Start at this item index; pass the previous run's `next_offset` to continue. Default: `0`. |
| `--value <value>` | Text the searched values must contain (case-insensitive). |

Examples:

```sh
mb field search 100 101 --value ada
mb field search 100 101 --value ada --limit 5 --json
mb field search 100 101 --limit 20 --json
```

## mb field remapping

Look up another field's value on the row where a field equals a value.

Returns `{ found: true, value, label }`, where `label` is the value of `<remapped-id>` on the row where `<id>` equals `<value>`, or `{ found: false }` when no row matches. A FK `<id>` is followed to the key it points at, and `<remapped-id>` must be on that key's table; a pair that isn't, or a failed warehouse query, also returns `{ found: false }`. For a numeric `<id>`, only the leading number of `<value>` counts (`20abc` looks up 20); put a negative value after `--` (`mb field remapping 100 101 -- -5`). The text output is the label alone; use `--json` to tell no match from an empty label.

```sh
mb field remapping <id> <remapped-id> <value> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id the value belongs to. |
| `<remapped-id>` | Field id whose value on that row is answered. |
| `<value>` | Value of &lt;id> to look up. |

Examples:

```sh
mb field remapping 100 101 20
mb field remapping 100 101 20 --json
NAME=$(mb field remapping 100 101 20 --format text)
```

## mb field set-sensitivity

Label a field's data sensitivity by hand, or withdraw the label with `none`.

The server's classifier never overwrites a label you set here. `none` withdraws your label, and the field then shows the classifier's label, if it wrote one. Returns the field with its `data_sensitivity`, which `mb field get <id>` reads back. Refused before the request (exit 2) on a server without `fieldDataSensitivity`.

```sh
mb field set-sensitivity <id> <label> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Field id. |
| `<label>` | Sensitivity label, most severe first (SEC_KEY \| SYS_TELEMETRY \| PHI \| BIO_GEN \| PCI_FIN \| SENS_PERS \| PII \| CORP_IP \| BIZ_CONF \| PUBLIC), or none to withdraw it. |

Needs `fieldDataSensitivity` (v64+).

Examples:

```sh
mb field set-sensitivity 100 PII
mb field set-sensitivity 100 none
mb field set-sensitivity 100 PHI --json
```
