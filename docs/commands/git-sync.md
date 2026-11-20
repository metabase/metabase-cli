---
title: "mb git-sync"
summary: "Sync Metabase content with a git remote."
---

# mb git-sync

Sync Metabase content with a git remote.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `remoteSync` (token remote_sync).

Agent skills:

- `mb skills get git-sync`: import/export round-trip and dirty checks

## Only admins can sync

The git-sync commands import and export Metabase content against the git remote that an admin set up. The server refuses anyone who isn't an admin.

## Import and export use the tracked branch

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync export-preflight](#mb-git-sync-export-preflight) work on the branch that git-sync tracks: the `remote-sync-branch` setting, which the server's `MB_REMOTE_SYNC_BRANCH` environment variable can also set. On Metabase 63 and newer, `import` and `export` without `--branch` refuse (exit 2) when no branch is tracked or the setting isn't readable. Older servers don't check: `import` goes through, and `export` writes to the branch the server tracks. `export-preflight` without `--branch` refuses the same way on every server, before it contacts the remote.

## Import, export and stash wait for their task

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync stash](#mb-git-sync-stash) start a task on the server, wait for it to end, and exit as [mb git-sync wait](#mb-git-sync-wait) does. `--no-wait` returns once the task starts.

## Don't answer a conflict with a retry

A task that ends in `conflict` names the conflict in its output and its error: the conflicting entities, or, for a plain export, the remote's change since the last sync. The server may then count the remote commit as synced, so a retry, `--merge` included, may not see the remote's changes. Keep the remote's side with `import --force`, keep Metabase's with `export --force`, or keep both through a reviewed PR from a new branch (`mb skills get git-sync`, section "After a conflict task").

## mb git-sync status

Show current git-sync state (remote, sync type, branch, dirty, current task).

Shows whether a remote is set up, the sync type (`read-only` or `read-write`), the tracked branch, the dirty flag, the most recent task (`null` when none has run) and the collections marked for sync. Refused (exit 2) on a server without the `remote_sync` token feature, where the sync scope would read as empty.

```sh
mb git-sync status [flags]
```

Examples:

```sh
mb git-sync status
mb git-sync status --json
```

## mb git-sync is-dirty

Check whether Metabase has unsynced local changes.

```sh
mb git-sync is-dirty [flags]
```

Examples:

```sh
mb git-sync is-dirty
mb git-sync is-dirty --json
```

## mb git-sync has-remote-changes

Check whether the remote branch has unimported changes.

Compares the latest version on the remote branch with the version Metabase last imported. The server may respond from a short-lived cache, and `cached` says when it did.

```sh
mb git-sync has-remote-changes [flags]
```

| Flag | Description |
| --- | --- |
| `--force-refresh` | Bypass the in-memory cache and re-check the remote. |

Also needs `remoteSyncRemoteChanges` (v59+, token remote_sync).

Examples:

```sh
mb git-sync has-remote-changes
mb git-sync has-remote-changes --force-refresh --json
```

## mb git-sync dirty

List objects with unsynced local changes.

```sh
mb git-sync dirty [flags]
```

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb git-sync dirty
mb git-sync dirty --json
```

## mb git-sync current-task

Get the most recent git-sync task (or idle if none).

Returns `{ "status": "idle" }` when no task has ever run.

```sh
mb git-sync current-task [flags]
```

Examples:

```sh
mb git-sync current-task
mb git-sync current-task --json
```

## mb git-sync cancel-task

Cancel the running git-sync task.

The server refuses with 400 when no task is running.

```sh
mb git-sync cancel-task [flags]
```

Examples:

```sh
mb git-sync cancel-task
mb git-sync cancel-task --json
```

## mb git-sync wait

Poll the current git-sync task until it reaches a terminal status.

Returns `{ "status": "idle" }` at once when no task has ever run, and the most recent task when it has already ended. Exits 0 when the task ends `successful` or `cancelled`, and 1 when it ends `errored`, `timed-out` or `conflict`.

```sh
mb git-sync wait [flags]
```

| Flag | Description |
| --- | --- |
| `--timeout <value>` | Polling timeout in ms. Default: `600000`. |
| `--interval <value>` | Polling interval in ms. Default: `2000`. |

Examples:

```sh
mb git-sync wait
mb git-sync wait --timeout 300000 --json
```

## mb git-sync import

Import content from the configured git remote into Metabase.

A plain import is refused while Metabase has changes it hasn't exported: `--force` discards them, and `--merge` keeps them and merges the remote's changes in. A merge ends in `conflict`, with local content untouched, when entities changed on both sides or there's no merge base (the remote history was rewritten, or the instance never synced). `--merge` is refused (exit 2) on a server without `remoteSyncMerge` (v63+, token remote_sync), which would run a plain import instead.

```sh
mb git-sync import [flags]
```

| Flag | Description |
| --- | --- |
| `-b, --branch <value>` | Branch to import from. Defaults to the tracked branch (the `remote-sync-branch` setting); can't be blank. |
| `--force` | Discard the changes Metabase hasn't exported. They're lost. |
| `--merge` | Keep the changes Metabase hasn't exported, and merge the remote's changes in. Can't be used with `--force`. |
| `--wait, --no-wait` | Poll the task until it ends. Default: `true`. |
| `--timeout <value>` | Polling timeout in ms (used with --wait). Default: `600000`. |
| `--interval <value>` | Polling interval in ms (used with --wait). Default: `2000`. |

Examples:

```sh
mb git-sync import
mb git-sync import --branch main --json
mb git-sync import --force --no-wait
mb git-sync import --merge
```

## mb git-sync export

Export Metabase changes back to the configured git remote.

Exports to the branch git-sync tracks. On v63+ servers, `--branch` must name that branch (409 otherwise); older servers export to the `--branch` you name and track it from then on, with a 400 unless its tip is the last synced commit or `--force` is given. To export to a new branch, run `git-sync stash` or `git-sync create-branch` first: a `--branch` the remote doesn't have is refused (exit 2). When the remote has moved past the last sync, a plain export ends in `conflict` (a 400 on older servers): `--merge` merges the remote's changes in, `--force` overwrites them, and `git-sync export-preflight` shows which applies. The output's `branch` names the target, or is `null` when an older server exported to the branch it tracks. `--merge` is refused (exit 2) on a server without `remoteSyncMerge` (v63+, token remote_sync), which would run a plain export instead.

```sh
mb git-sync export [flags]
```

| Flag | Description |
| --- | --- |
| `-b, --branch <value>` | Branch to export to. Defaults to the tracked branch (the `remote-sync-branch` setting), which it must be on v63+ servers; can't be blank. |
| `-m, --message <value>` | Commit message. |
| `--force` | Force-push, overwriting the remote's changes. |
| `--merge` | When the remote has moved on, merge its changes in instead of ending in `conflict`. Entities changed on both sides still end in `conflict`, and nothing is written. Can't be used with `--force`. |
| `--wait, --no-wait` | Poll the task until it ends. Default: `true`. |
| `--timeout <value>` | Polling timeout in ms (used with --wait). Default: `600000`. |
| `--interval <value>` | Polling interval in ms (used with --wait). Default: `2000`. |

Examples:

```sh
mb git-sync export -m "update dashboards"
mb git-sync export --merge -m "update dashboards"
mb git-sync export --branch main --json
mb git-sync export --no-wait
```

## mb git-sync export-preflight

Preview what an export would do against the live remote branch, without writing.

Compares Metabase's content with the remote branch. `has_changes` says whether the remote moved past the last sync (`false` before the first sync), `clean` whether a merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would bring in, and `force_push_casualties` names the remote content a force push would discard (empty before the first sync, when a forced export replaces the remote's managed folders whole). `reason` is `history-rewritten` when the remote was force-pushed or rebased, so only `export --force` can push; otherwise it's `null`. When `clean` is `true`, run `export --merge`. When it's `false`, run `create-branch <name>` and then `export`, and open a PR into the old branch.

```sh
mb git-sync export-preflight [flags]
```

| Flag | Description |
| --- | --- |
| `-b, --branch <value>` | Branch to preview against. Defaults to the tracked branch (the `remote-sync-branch` setting), which it must be (409 otherwise); can't be blank. |

Also needs `remoteSyncExportPreflight` (v63+, token remote_sync).

Examples:

```sh
mb git-sync export-preflight
mb git-sync export-preflight --branch main --json
```

## mb git-sync stash

Export current Metabase state to a new branch on the git remote.

Creates the branch, exports Metabase's current state to it, and switches git-sync to it. The server refuses it unless `remote-sync-type` is `read-write`.

```sh
mb git-sync stash [flags]
```

| Flag | Description |
| --- | --- |
| `--new-branch <value>` | Required. Branch to create and export to. |
| `-m, --message <value>` | Commit message. Default: `Stashed from mb CLI`. |
| `--wait, --no-wait` | Poll the task until it ends. Default: `true`. |
| `--timeout <value>` | Polling timeout in ms (used with --wait). Default: `600000`. |
| `--interval <value>` | Polling interval in ms (used with --wait). Default: `2000`. |

Examples:

```sh
mb git-sync stash --new-branch wip
mb git-sync stash --new-branch wip -m "work in progress" --json
```

## mb git-sync branches

List branches on the configured git remote.

```sh
mb git-sync branches [flags]
```

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb git-sync branches
mb git-sync branches --json
```

## mb git-sync create-branch

Create a new branch on the git remote and switch git-sync to it.

The branch starts at the last synced commit, or at the tracked branch's tip when nothing has synced yet. Nothing is exported until the next `git-sync export`.

```sh
mb git-sync create-branch <name> [flags]
```

| Argument | Description |
| --- | --- |
| `<name>` | Branch name. |

Examples:

```sh
mb git-sync create-branch feat/dashboards
mb git-sync create-branch feat/x --json
```

## mb git-sync add-collection

Mark a collection as git-synced; cascades to descendants by location prefix.

The server refuses the change while `remote-sync-type` is `read-only`, its default: switch first with `mb setting set remote-sync-type '"read-write"'`. Returns `{ success, task_id? }`, with `task_id` only when the change starts a follow-up task on the server.

```sh
mb git-sync add-collection <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id (positive integer). |

Examples:

```sh
mb git-sync add-collection 12
mb git-sync add-collection 12 --json --profile prod
```

## mb git-sync remove-collection

Unmark a collection as git-synced; cascades to descendants by location prefix.

Like `add-collection`, it's refused while `remote-sync-type` is `read-only`, and returns `{ success, task_id? }`.

```sh
mb git-sync remove-collection <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id (positive integer). |

Examples:

```sh
mb git-sync remove-collection 12
mb git-sync remove-collection 12 --json --profile prod
```
