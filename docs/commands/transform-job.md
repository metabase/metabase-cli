---
title: "mb transform-job"
summary: "Manage Metabase transform jobs."
---

# mb transform-job

Manage Metabase transform jobs.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `transforms` (v59+).

Agent skills:

- `mb skills get transform`: tag-driven job schedules

## mb transform-job list

List transform jobs.

```sh
mb transform-job list [flags]
```

Also takes the [list](README.md#list-flags) flags.

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

Also takes the [body](README.md#body-flags) flags.

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

Also takes the [body](README.md#body-flags) flags.

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform job id. |
| `--yes` | Skip confirmation. |

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform job id. |
| `--force-refresh` | Re-run the whole plan, including dependencies that are already fresh. |

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

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb transform-job transforms 1
mb transform-job transforms 1 --json
```

## mb transform-job set-active

Activate or deactivate every transform job.

Flips the active flag on every transform job at once. Inactive jobs don't run on schedule; manual runs ignore the flag. Needs an admin.

```sh
mb transform-job set-active <active> [flags]
```

| Argument | Description |
| --- | --- |
| `<active>` | true to activate all jobs, false to deactivate. |

Also needs `transformJobActivation` (v61+).

Examples:

```sh
mb transform-job set-active false
mb transform-job set-active true --json
```
