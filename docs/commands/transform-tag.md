---
title: "mb transform-tag"
summary: "Manage Metabase transform tags."
---

# mb transform-tag

Manage Metabase transform tags.

Agent skills:

- `mb skills get transform`: tags that drive job schedules

## Tags, transforms and jobs

Tags group transforms and jobs. A transform or a job names its tags by id in its `tag_ids` field (see [`mb transform update`](transform.md#mb-transform-update) and [`mb transform-job update`](transform-job.md#mb-transform-job-update)). The four built-in tags, `hourly`, `daily`, `weekly` and `monthly`, drive the four built-in jobs.

There is no command to get one tag by id: read it from [`mb transform-tag list`](#mb-transform-tag-list).

## mb transform-tag list

List transform tags.

```sh
mb transform-tag list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-tag list --output`.

Examples:

```sh
mb transform-tag list
mb transform-tag list --json
```

## mb transform-tag create

Create a transform tag.

```sh
mb transform-tag create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform-tag create`. Output schema: `mb schema transform-tag create --output`.

Examples:

```sh
mb transform-tag create --body '{"name":"nightly"}'
mb transform-tag create --file tag.json
echo '{"name":"nightly"}' | mb transform-tag create
```

## mb transform-tag update

Update a transform tag by id.

```sh
mb transform-tag update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform tag id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform-tag update`. Output schema: `mb schema transform-tag update --output`.

Examples:

```sh
mb transform-tag update 5 --body '{"name":"renamed"}'
mb transform-tag update 5 --file tag.json
echo '{"name":"renamed"}' | mb transform-tag update 5
```

## mb transform-tag delete

Delete a transform tag by id.

```sh
mb transform-tag delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform tag id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-tag delete --output`.

Examples:

```sh
mb transform-tag delete 5 --yes
mb transform-tag delete 5
```
