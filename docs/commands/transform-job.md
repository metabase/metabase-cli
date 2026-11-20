---
title: "mb transform-job"
summary: "Manage Metabase transform jobs."
---

# mb transform-job

Manage Metabase transform jobs.

Agent skills:

- `mb skills get transform`: tag-driven job schedules

## mb transform-job list

List transform jobs.

```sh
mb transform-job list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-job list --output`.

Examples:

```sh
mb transform-job list
mb transform-job list --json
```

## mb transform-job get

Get a transform job by id.

```sh
mb transform-job get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform job id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-job get --output`.

Examples:

```sh
mb transform-job get 1
mb transform-job get 1 --json
```

## mb transform-job create

Create a transform job.

```sh
mb transform-job create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform-job create`. Output schema: `mb schema transform-job create --output`.

Examples:

```sh
cat job.json | mb transform-job create
mb transform-job create --file job.json
mb transform-job create --body '{"name":"daily","schedule":"0 0 0 * * ?"}'
```

## mb transform-job update

Update a transform job by id.

```sh
mb transform-job update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform job id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform-job update`. Output schema: `mb schema transform-job update --output`.

Examples:

```sh
cat patch.json | mb transform-job update 1
mb transform-job update 1 --file patch.json
mb transform-job update 1 --body '{"schedule":"0 0 6 * * ?"}'
```

## mb transform-job delete

Delete a transform job by id.

```sh
mb transform-job delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform job id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-job delete --output`.

Examples:

```sh
mb transform-job delete 1 --yes
mb transform-job delete 1
```

## mb transform-job run

Trigger a transform job run by id.

Starts the job and returns immediately. The job runs every transform carrying one of its tags, plus those transforms' dependencies. Dependencies that are already fresh are skipped by default; --force-refresh re-runs the whole plan including them.

```sh
mb transform-job run <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform job id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--force-refresh` | `false` | Re-run the whole plan, including dependencies that are already fresh. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-job run --output`.

Examples:

```sh
mb transform-job run 1
mb transform-job run 1 --force-refresh --json
```

## mb transform-job transforms

List the transforms a job will run.

Resolves the transforms a job would execute, matched by the job's tags. The positional id is a JOB id, not a transform id.

```sh
mb transform-job transforms <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform job id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform-job transforms --output`.

Examples:

```sh
mb transform-job transforms 1
mb transform-job transforms 1 --json
```

## mb transform-job set-active

Activate or deactivate every transform job.

Flips the active flag on every transform job at once. Inactive jobs do not run on schedule; manual runs ignore the flag. Requires admin.

```sh
mb transform-job set-active <active> [flags]
```

| Argument | Description |
| --- | --- |
| `<active>` | true to activate all jobs, false to deactivate. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformJobActivation` (v61+), `transforms` (v59+).

Output schema: `mb schema transform-job set-active --output`.

Examples:

```sh
mb transform-job set-active false
mb transform-job set-active true --json
```
