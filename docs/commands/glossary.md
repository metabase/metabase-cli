---
title: "mb glossary"
summary: "Manage the Metabase glossary of business terms."
---

# mb glossary

Manage the Metabase glossary of business terms.

## The glossary

The glossary is the instance-wide list of business terms and their definitions. Its entries are listed on the Glossary pages of Data Studio and the Data Reference, and Metabot gets them as context, so a definition written once shapes every answer that uses the term.

Every command runs on every supported server, and a server may restrict writes to admins and data analysts. There is no command that gets one entry by id: use [mb glossary list](#mb-glossary-list) with `--search`.

## mb glossary list

List glossary entries in term order.

`--search` matches the term or the definition as a case-insensitive substring. Some servers read `%` and `_` in the text as SQL LIKE wildcards rather than literal characters. A blank `--search` is refused.

```sh
mb glossary list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--search <value>` |  | Keep entries whose term or definition contains this text (case-insensitive). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema glossary list --output`.

Examples:

```sh
mb glossary list
mb glossary list --search churn --json
```

## mb glossary create

Create a glossary entry, a term and its definition.

Pass `--term` and `--definition` together, or a JSON body with exactly those two keys. The flags are refused beside `--body` or `--file`, and a body piped on stdin is not read while they are given. Neither field may be blank. Terms are unique.

```sh
mb glossary create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--term <value>` |  | The term (used with --definition). |
| `--definition <value>` |  | The definition (used with --term). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema glossary create`. Output schema: `mb schema glossary create --output`.

Examples:

```sh
mb glossary create --term "Churn" --definition "Customers lost in a period"
mb glossary create --body '{"term":"Churn","definition":"Customers lost in a period"}'
mb glossary create --file entry.json
```

## mb glossary update

Replace the term and definition of a glossary entry.

Both fields are replaced, so pass `--term` and `--definition` together, or a JSON body with exactly those two keys. The flags are refused beside `--body` or `--file`, and a body piped on stdin is not read while they are given. Neither field may be blank.

```sh
mb glossary update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Glossary entry id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--term <value>` |  | The term (used with --definition). |
| `--definition <value>` |  | The definition (used with --term). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema glossary update`. Output schema: `mb schema glossary update --output`.

Examples:

```sh
mb glossary update 3 --term "Churn" --definition "Customers lost in a calendar month"
mb glossary update 3 --body '{"term":"Churn","definition":"Customers lost in a calendar month"}'
mb glossary update 3 --file entry.json
```

## mb glossary delete

Delete a glossary entry by id.

```sh
mb glossary delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Glossary entry id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema glossary delete --output`.

Examples:

```sh
mb glossary delete 3 --yes
mb glossary delete 3
```
