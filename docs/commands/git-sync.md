---
title: "mb git-sync"
summary: "Sync Metabase content with a git remote."
---

# mb git-sync

Sync Metabase content with a git remote.

Agent skills:

- `mb skills get git-sync`: import/export round-trip and dirty checks

## mb git-sync status

Show current git-sync state (remote, sync type, branch, dirty, current task).

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

A plain import refuses while Metabase holds un-pushed changes; --force discards them, --merge (Metabase 63+) keeps them and folds the remote's changes in by a three-way merge. A merge ends the task in `conflict`, leaving local content untouched, when entities changed on both sides or when there is no merge base: the remote history was rewritten, or the instance has never synced. A task that ends in `conflict` may make the server count the remote commit it saw as synced, so a retry, --merge included, may no longer see the remote's changes. Never answer a conflict with a retry: keep the remote's side with `import --force`, Metabase's with `export --force`, or both through a reviewed PR from a new branch (`mb skills get git-sync`, "After a conflict task").

```sh
mb git-sync import [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to import from (defaults to remote-sync-branch setting). |
| `--force` | `false` | Discard local Metabase-side dirty changes (LOSSY). |
| `--merge` | `false` | Keep un-pushed local changes and fold the remote's in by a three-way merge. |
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

The export targets the branch git-sync tracks. On Metabase 63+ `--branch` defaults to it and must name it (the server answers 409 for any other branch); older servers export to the branch `--branch` names and switch git-sync to it, refusing with 400 when that branch's tip is not the last synced commit unless --force is given. To push to a new branch, use `git-sync stash` or `git-sync create-branch` first; a `--branch` missing from the remote is refused before the export with a pointer to `create-branch`. When the remote has moved past the last sync, a plain export ends in a `conflict` task on 63+ and is refused with 400 on older servers. --merge (63+) folds the remote's changes in by a three-way merge (entities changed on both sides still end in `conflict`), --force overwrites them. `git-sync export-preflight` previews which applies. A task that ends in `conflict` may make the server count the remote commit it saw as synced, so a retry, --merge included, may no longer see the remote's changes. Never answer a conflict with a retry: keep the remote's side with `import --force`, Metabase's with `export --force`, or both through a reviewed PR from a new branch (`mb skills get git-sync`, "After a conflict task").

```sh
mb git-sync export [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to export to (defaults to the remote-sync-branch setting; on 63+ it must be that branch). |
| `-m, --message <value>` |  | Commit message. |
| `--force` | `false` | Force-push / overwrite remote. |
| `--merge` | `false` | When the remote moved on, fold its changes in by a three-way merge instead of ending in conflict. |
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

Compares the current Metabase content with the remote branch. `has_changes` says whether the remote has advanced past the last synced version (false when nothing has been synced yet, and, on servers that count a task that ended in `conflict` as synced, after one), `clean` whether a three-way merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would fold in, `force_push_casualties` names the remote content a force push would discard (empty when nothing has been synced yet, although a forced export then replaces the remote's managed directories wholesale), and `reason` is `history-rewritten` when the remote was force-pushed or rebased so no merge base exists. The branch must be the one git-sync tracks; the server answers 409 otherwise.

```sh
mb git-sync export-preflight [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-b, --branch <value>` |  | Branch to preview against (defaults to the remote-sync-branch setting; must be that branch). |

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
