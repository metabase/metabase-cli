---
title: "mb git-sync"
summary: "Sync Metabase content with a git remote."
---

# mb git-sync

Sync Metabase content with a git remote.

Agent skills:

- `mb skills get git-sync`: import/export round-trip and dirty checks

## Access

The git-sync commands drive Metabase Enterprise remote sync, which imports and exports Metabase content against a git remote that an admin configured. Each command needs the `remote_sync` premium feature on an active token, and an admin: the server refuses other users.

## The tracked branch

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync export-preflight](#mb-git-sync-export-preflight) work on the branch that git-sync tracks, the `remote-sync-branch` setting. Each one reads it from the session properties just before its request, so a branch that the server's `MB_REMOTE_SYNC_BRANCH` environment variable sets counts too. The same read is the probe that judges the server, so it costs no request of its own.

- `import` asserts the tracked branch. Metabase 63 and newer reject an import whose assertion disagrees with the setting. So there, when no branch is tracked, or when the caller is not an admin and cannot read the setting, the command refuses (exit 2) rather than read the setting as unset. Older servers ignore the assertion: they get it when the setting is readable and set, and none otherwise.
- `export` without `--branch` reads the tracked branch, and refuses, as `import` does on Metabase 63 and newer. Older servers get no branch, and export to the branch that they track.
- `export-preflight` without `--branch` previews the tracked branch. When no branch is tracked, or the setting is not readable, it refuses (exit 2) before it contacts the remote.

An Enterprise server without the `remote_sync` token still shows an admin the setting, which would read as a branch that git-sync tracks. So on such a server, [mb git-sync status](#mb-git-sync-status), `export-preflight` without `--branch`, and `export --branch` refuse (exit 2) on the probe that reads the setting. An `import`, or an `export` without `--branch`, is sent without the tracked branch there, and the server's refusal names the missing feature.

## Tasks and conflicts

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync stash](#mb-git-sync-stash) start a task on the server. By default, each one polls the task until it reaches a terminal status, and ends as [mb git-sync wait](#mb-git-sync-wait) does. `--no-wait` returns when the task starts.

A task that ends in `conflict` names the conflict in its text output and in its error: the conflicting entities, or, for a plain export, the change on the remote branch since the last sync. The server may then count the remote commit that the task saw as synced, so a retry, `--merge` included, may not see the remote's changes. Never answer a conflict with a retry. Keep the remote's side with `import --force`, keep Metabase's with `export --force`, or keep both through a reviewed PR from a new branch (`mb skills get git-sync`, section "After a conflict task").

## mb git-sync status

Show current git-sync state (remote, sync type, branch, dirty, current task).

Reads whether a remote is configured, the sync type (`read-only` or `read-write`), the tracked branch, the dirty flag, the most recent task (`null` when none has ever run) and the collections marked for sync. On a server without the `remote_sync` feature it refuses (exit 2) rather than misread the responses: the collection read behind the sync scope is refused before it's sent, because such a server lists its collections without the sync flag, which would read as an empty scope.

```sh
mb git-sync status [flags]
```

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync status --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync is-dirty --output`.

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

| Flag | Default | Description |
| --- | --- | --- |
| `--force-refresh` | `false` | Bypass the in-memory cache and re-check the remote. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSyncRemoteChanges` (v59+, token remote_sync).

Output schema: `mb schema git-sync has-remote-changes --output`.

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

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync dirty --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync current-task --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync cancel-task --output`.

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

| Flag | Default | Description |
| --- | --- | --- |
| `--timeout <value>` | `600000` | Polling timeout in ms. |
| `--interval <value>` | `2000` | Polling interval in ms. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync wait --output`.

Examples:

```sh
mb git-sync wait
mb git-sync wait --timeout 300000 --json
```

## mb git-sync import

Import content from the configured git remote into Metabase.

A plain import refuses while Metabase holds un-pushed changes; `--force` discards them, and `--merge` keeps them and folds the remote's changes in by a three-way merge. A merge ends the task in `conflict`, leaving local content untouched, when entities changed on both sides or when there's no merge base: the remote history was rewritten, or the instance has never synced. `--merge` needs `remoteSyncMerge` (v63+, token remote_sync): on a server without it, the CLI refuses `--merge` before the request (exit 2), because such a server ignores it and runs a plain import.

```sh
mb git-sync import [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to import from (defaults to remote-sync-branch setting); a blank name is refused. |
| `--force` | `false` | Discard local Metabase-side dirty changes (LOSSY). |
| `--merge` | `false` | Keep un-pushed local changes and fold the remote's in by a three-way merge. Can't be used with `--force`. |
| `--wait, --no-wait` | `true` | Poll the resulting task until it reaches a terminal status (default: true; pass --no-wait to fire-and-forget). |
| `--timeout <value>` | `600000` | Polling timeout in ms (used with --wait). |
| `--interval <value>` | `2000` | Polling interval in ms (used with --wait). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync import --output`.

Examples:

```sh
mb git-sync import
mb git-sync import --branch main --json
mb git-sync import --force --no-wait
mb git-sync import --merge
```

## mb git-sync export

Export Metabase changes back to the configured git remote.

The export targets the branch git-sync tracks. On Metabase 63+ `--branch` defaults to it and must name it (the server responds with a 409 for any other branch); older servers export to the branch `--branch` names and switch git-sync to it, refusing with a 400 when that branch's tip isn't the last synced commit unless `--force` is given. To push to a new branch, use `git-sync stash` or `git-sync create-branch` first: a `--branch` other than the tracked one is looked up on the remote, and one missing there is refused before the export (exit 2) with a pointer to `create-branch`. The result's `branch` names the target, and the text output ends with it; it's `null` only when no `--branch` was given and a server older than 63 exported to the branch it tracks. When the remote has moved past the last sync, a plain export ends in a `conflict` task on 63+ and is refused with a 400 on older servers; `--merge` folds the remote's changes in by a three-way merge, `--force` overwrites them, and `git-sync export-preflight` previews which applies. `--merge` needs `remoteSyncMerge` (v63+, token remote_sync): on a server without it, the CLI refuses `--merge` before the request (exit 2), because such a server ignores it and runs a plain export.

```sh
mb git-sync export [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to export to (defaults to the remote-sync-branch setting; on 63+ it must be that branch); a blank name is refused. |
| `-m, --message <value>` |  | Commit message. |
| `--force` | `false` | Force-push / overwrite remote. |
| `--merge` | `false` | When the remote moved on, fold its changes in by a three-way merge instead of ending in `conflict`; entities changed on both sides still end in `conflict`, writing nothing. Can't be used with `--force`. |
| `--wait, --no-wait` | `true` | Poll the resulting task until it reaches a terminal status (default: true; pass --no-wait to fire-and-forget). |
| `--timeout <value>` | `600000` | Polling timeout in ms (used with --wait). |
| `--interval <value>` | `2000` | Polling interval in ms (used with --wait). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync export --output`.

Examples:

```sh
mb git-sync export -m "update dashboards"
mb git-sync export --merge -m "update dashboards"
mb git-sync export --branch main --json
mb git-sync export --no-wait
```

## mb git-sync export-preflight

Preview what an export would do against the live remote branch, without writing.

Compares the current Metabase content with the remote branch. `has_changes` says whether the remote has advanced past the last synced version (`false` when nothing has been synced yet, and, on servers that count a task that ended in `conflict` as synced, after one), `clean` whether a three-way merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would fold in, `force_push_casualties` names the remote content a force push would discard (empty when nothing has been synced yet, although a forced export then replaces the remote's managed directories wholesale), and `reason` is `history-rewritten` when the remote was force-pushed or rebased so no merge base exists (no merge is possible then, and only `export --force` can push), otherwise `null`. When `clean` is `true`, `export --merge` applies the merge; when it's `false`, `create-branch <name>` and then `export` push Metabase's state to a new branch, for a PR into the old one. The text output is one headline for the branch, then the conflicts, the merge summary and the force-push casualties, each only when there is something to list. The branch must be the one git-sync tracks; the server responds with a 409 otherwise.

```sh
mb git-sync export-preflight [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to preview against (defaults to the remote-sync-branch setting; must be that branch); a blank name is refused. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSyncExportPreflight` (v63+, token remote_sync), `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync export-preflight --output`.

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

| Flag | Default | Description |
| --- | --- | --- |
| `--new-branch <value>` |  | Required. Branch to create and export to. |
| `-m, --message <value>` | `Stashed from mb CLI` | Commit message. |
| `--wait, --no-wait` | `true` | Poll the resulting task until it reaches a terminal status (default: true; pass --no-wait to fire-and-forget). |
| `--timeout <value>` | `600000` | Polling timeout in ms (used with --wait). |
| `--interval <value>` | `2000` | Polling interval in ms (used with --wait). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync stash --output`.

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

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync branches --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync create-branch --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync add-collection --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `remoteSync` (token remote_sync).

Output schema: `mb schema git-sync remove-collection --output`.

Examples:

```sh
mb git-sync remove-collection 12
mb git-sync remove-collection 12 --json --profile prod
```
