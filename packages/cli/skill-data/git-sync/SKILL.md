---
name: git-sync
description: Put a repository branch into the connected Metabase and read the sync state with `mb git-sync …`, covering status, dirty and has-remote-changes checks, import with wait, branches, the in-flight task, and the guard before importing the tracked branch. Load when the user wants to "sync", "import my branch", "put my branch into Metabase", "is Metabase behind the repo", or anything `mb git-sync …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [remoteSync]
---

# git-sync (repository to instance)

Content lives in this repository as YAML in the representation format (`mb skills get metabase-representation-format`) and reaches the connected Metabase through remote sync. The instance is configured with a remote, a tracked branch and the collections under sync; `mb git-sync import --branch <branch>` pulls a branch of that remote and applies it. Only collections flagged for sync are read, and a file outside the serialized layout (`collections/`, `databases/`, `transforms/`, `python_libraries/`) never applies.

The direction is one way: files are edited here, checked with `mb validate`, committed and pushed with `git`, then imported. Exporting from the instance, stashing, creating branches on the instance and changing the sync scope are admin actions in Metabase, not commands here.

## Read state before importing

```bash
mb git-sync status              --json   # the branch the instance holds, dirty, current task, synced collections
mb git-sync is-dirty            --json   # {is_dirty}: the instance has changes the repository does not
mb git-sync has-remote-changes  --json   # {has_changes, remote_version, local_version, cached}
mb git-sync dirty               --json   # the dirty objects, one row each
mb git-sync current-task        --json   # the in-flight task, or idle
```

Importing into a dirty instance is refused unless you pass `--force`, which discards the changes made in the Metabase UI.

## The branch guard

`import --branch` changes what the connected instance holds for everyone who uses it. Read `status` first and name the branch the instance holds. When the branch you are about to import is the tracked branch (`main` or `master`, or whatever `status` reports as the configured branch), stop and confirm with the user: that import publishes the branch as reviewed content, which is the reviewer's step after the pull request merges. The session's own branch is what the loop imports.

## Import

```bash
mb git-sync import --branch <branch>     # waits for a terminal status by default
```

| Flag              | Purpose                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `--branch <name>` | The branch to import; defaults to the instance's tracked branch, so always pass it     |
| `--no-wait`       | Return once queued; `mb git-sync wait` later                                           |
| `--force`         | Discards changes made in the Metabase UI since the last import (lossy). Confirm first. |
| `--timeout <ms>`  | Polling deadline. Default 600 000.                                                     |
| `--interval <ms>` | Polling cadence. Default 2 000.                                                        |

Workflow:

1. `mb validate` over the changed files, then commit and push the branch. The branch must be on the remote; an import of an unpushed branch fails naming the missing branch.
2. Read state and apply the branch guard. Confirm `is_dirty: false`, or that `--force` is intended.
3. `mb git-sync import --branch <branch>`.
4. `mb git-sync status --json`: the instance reports the imported branch and `is_dirty: false`.

A failed import (`errored`, `conflict`) names the file and the field the server rejected in the command's JSON. Fix the file, validate, push, import again. A file `mb validate` accepts can still fail here when it references a table, card or collection the instance does not have.

## Branches, waiting, cancelling

```bash
mb git-sync branches --json    # the remote's branches, as the instance sees them
mb git-sync wait               # block on the in-flight task
mb git-sync cancel-task        # abandon a hung task
```

Create branches with `git`, never on the instance.

## Sync scope

The collections under sync carry `is_remote_synced: true`; each serializes to its own folder under `collections/`. `status --json` lists them under `synced_collections`, and `mb collection get <id> --json` shows the flag. A file in a collection outside that set does not apply. Changing the set is an admin action in Metabase's remote sync settings.

<!-- requires: library -->

## Published table metadata

Table and field metadata (descriptions, semantic types, FK targets) and the table's segments and measures serialize under `databases/<db>/schemas/<schema>/tables/<table>/` for Library-published tables, and only when the Library collection holding them is itself under sync. A metadata file for an unpublished table never applies. Publish first (`mb library publish --table-ids <id>`), confirm the Library Data collection is in `synced_collections`, then import. The `metadata` skill covers the files.

<!-- /requires -->

## Don't

- Don't import the tracked branch without the user's confirmation.
- Don't run `import --force` without explicit confirmation; it discards work done in the Metabase UI.
- Don't read an empty `dirty` list as "this kind of change is not tracked". Dirty tracking covers eligible objects only; check `synced_collections` first.
- Don't drive `git-sync` against an instance without remote sync configured; every verb errors naming the missing settings.
