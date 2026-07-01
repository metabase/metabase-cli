---
name: git-sync
description: Round-trip Metabase content (cards, dashboards, transforms, snippets, collections) between an instance and a git remote via `mb git-sync …` — status, dirty / has-remote-changes checks, import, export (with branch guard), branches, stash, add/remove a collection from sync. Load when the user wants to "import the latest changes", "export to git", "git sync", "dirty check", "stash before pulling", "add a collection to sync", or anything `mb git-sync …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# git-sync (representations ↔ instance)

Metabase content (cards, dashboards, transforms, snippets, collections, …) can live in a git repo as YAML and round-trip in and out of a Metabase instance via the `git-sync` verbs. The instance is configured with a `remote-sync-*` settings block (URL, branch, token, type read-only/read-write); the CLI drives the sync tasks against `/api/ee/remote-sync/*`. Only collections flagged for sync serialize; everything else is local-only.

This skill covers the import/export workflow. Flag conventions and auth setup live in `core` (`mb skills get core`). To author content YAML by hand: the per-resource clause and settings shapes mirror the API form — query bodies follow the `mbql` skill, `visualization_settings` follow the `visualization` skill — except the portable YAML uses **name-based** references (e.g. `[Sample Database, PUBLIC, ORDERS, TOTAL]`, and entity-ids for cross-entity FKs) where the API form uses numeric ids. For the on-disk folder layout, model new files on what the synced repo already contains.

## Precondition: read state before mutating

Always run `status` (or `is-dirty` + `has-remote-changes`) before `import` or `export`. Importing on a dirty instance silently rejects unless you pass `--force`; exporting when the instance is behind the remote pushes a stale state.

```bash
mb git-sync status              --profile <n> --json   # → branch, dirty, current task
mb git-sync is-dirty            --profile <n> --json   # → {dirty: bool}; instance has unexported changes
mb git-sync has-remote-changes  --profile <n> --json   # → {behind: bool}; remote has unimported commits
mb git-sync dirty               --profile <n> --json   # → list the dirty objects
mb git-sync current-task        --profile <n> --json   # → in-flight task (or idle)
```

**Clean up before exporting.** If you've created entities you intend to delete (a failed transform you're going to retry, a card you authored to test a body shape, a draft dashboard) — do the deletes _before_ the first `git-sync export`. Once committed, the cleanup needs a second commit, and the failed entity stays visible in `git log` forever. For transforms, prefer `transform update <id>` over delete + create (see the `transform` skill).

## Import (remote → instance)

```bash
mb git-sync import --branch <branch> --profile <n>
# Default flags: --wait, polling --interval 2000 --timeout 600000
```

Pulls the configured branch and applies it to the instance. Polls until the task reaches a terminal state (`succeeded` / `failed`).

| Flag              | Purpose                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--branch <name>` | Defaults to the `remote-sync-branch` setting; override per-call.                     |
| `--no-wait`       | Return as soon as the task is queued; combine with `mb git-sync wait` later.         |
| `--force`         | **Discards local Metabase-side dirty changes** (lossy). Confirm with the user first. |
| `--timeout <ms>`  | Polling deadline. Default 600 000.                                                   |
| `--interval <ms>` | Polling cadence. Default 2 000.                                                      |

Workflow:

1. Read state (above) — confirm `dirty: false` (or `--force` is intended).
2. Confirm `has-remote-changes` reports there's actually something to import.
3. `git-sync import --branch <branch>` — runs to terminal status by default.

## Export (instance → remote)

```bash
mb git-sync export -m "commit message" --branch <branch> --profile <n>
```

Pushes Metabase-side changes back to the configured remote. `-m` is the commit message; without it the server picks a default. Defaults to `--wait`.

| Flag                | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `--branch <name>`   | Push to a specific branch instead of the configured one. |
| `-m, --message <s>` | Commit message.                                          |
| `--force`           | Force-push / overwrite remote. Confirm with the user.    |
| `--no-wait`         | Don't poll.                                              |

Workflow:

1. **Branch guard** (below) — confirm the instance isn't tracking `main`/`master`, or that the user has explicitly accepted exporting to it.
2. Read state (above) — confirm `is-dirty` reports there's something to export.
3. `git-sync export -m "..."` — pushes and polls.
4. (Optional) `git-sync status` — verify `dirty: false` after.

### Branch guard: don't export to main/master without confirmation

Sync work is conventionally done on a feature branch — exporting to `main` (or `master`) commits team-shared content directly. Before `git-sync export`, check the tracked branch and if it's `main`/`master`, ask the user whether to switch first.

Read the current branch with `mb git-sync status --profile <n> --json | jq -r '.branch'`.

If the branch is `main` or `master`, prompt with `AskUserQuestion`:

> "The instance is tracking `<branch>` — exporting commits straight to it. Switch to a feature branch first?"
>
> 1. **Create a feature branch** — agent suggests a name (e.g., `agent/<task>`); run `mb git-sync create-branch <name> --profile <n>`. This exports current dirty state to the new branch and switches the instance's tracked branch to it; subsequent `git-sync export` calls go to that branch.
> 2. **Proceed on `main`/`master`** — explicitly accepted.

Skip the prompt only if the user's instructions already specified the branch (e.g., they explicitly said "export to main" or named a feature branch). Don't silently default to whatever `remote-sync-branch` happens to point at.

## Branches

```bash
mb git-sync branches --profile <n> --json                 # list remote branches
mb git-sync create-branch <name> --profile <n>            # create + switch sync to it
mb git-sync stash --profile <n>                           # export current state to a NEW branch
```

`stash` is the safe move when the instance has team work you don't want to lose, but you need to pivot to a different branch (`import` would discard, `export --force` would overwrite). It exports current state to a fresh branch first.

## Polling and cancelling

```bash
mb git-sync wait --profile <n>             # block on the in-flight task
mb git-sync cancel-task --profile <n>      # cancel the in-flight task
```

Use `wait` after `import --no-wait` / `export --no-wait`. Use `cancel-task` if a git-sync task hangs and you want to abandon it.

## Adding / removing a directory (collection) to sync

The set of directories under sync is governed by which **collections** carry `is_remote_synced: true`. Every collection so flagged serializes to its own folder under `collections/` in the repo; everything outside that set is local-only. The CLI exposes per-collection toggles that route to the underlying bulk endpoint (`PUT /api/ee/remote-sync/settings`):

```bash
mb git-sync add-collection    <collection-id> --profile <n> --json
mb git-sync remove-collection <collection-id> --profile <n> --json
```

`<collection-id>` is a **positive integer** (the bulk endpoint's schema is `pos-int? → boolean`; nano-id / `root` / `trash` refs are not supported). Get the id from `collection list` (see `core`).

Both verbs return `{ success: true, task_id?: <id> }`. The optional `task_id` only appears when the toggle triggered a follow-up task (e.g., a finalization import after switching to read-only mode); for a normal add/remove in read-write, expect `{ success: true }` and nothing else.

**Cascade.** A toggle on a parent cascades to every descendant by `location` prefix — `add-collection 4` flips `4` plus every collection nested under it. `remove-collection 4` is the symmetric inverse. There is no per-leaf-only mode.

**Mode prerequisite.** The server rejects toggles while `remote-sync-type` is `:read-only` (the install default). If `mb git-sync add-collection 12` returns `Metabase returned 400 … Cannot change synced collections when remote-sync-type is read-only.`, switch first with:

```bash
mb setting set remote-sync-type '"read-write"' --profile <n>
```

(`setting set` parses the value as strict JSON — mind the inner double quotes; see `core`.) The server also rejects switching to `:read-only` while the Remote Sync collection is dirty; export or `--force` import first if you're going the other way.

**Verifying the result.** The CLI's `Collection` schema doesn't yet expose `is_remote_synced`, so `collection get --json` won't show the flag. The pragmatic confirmation paths are:

- `mb git-sync is-dirty --profile <n> --json` after editing a card in the now-synced collection — a `true` reading proves it's tracked.
- The Metabase Admin UI's Remote Sync page renders the per-collection toggles.

## Don't (git-sync-specific)

- Don't run `git-sync import --force` or `git-sync export --force` without explicit user confirmation. Both are lossy — `--force` import discards instance-side work, `--force` export overwrites the remote branch.
- Don't drive `git-sync` against a Metabase instance that doesn't have remote-sync configured — every verb returns an error pointing at the missing `remote-sync-*` settings. To check: `mb setting get remote-sync-url --profile <n> --json`.
- Don't author content directly via `card create` / `transform create` and then assume `git-sync export` will commit it cleanly — the instance and repo can drift if you mix direct API writes with sync-tracked changes. If you do, follow direct writes immediately with `git-sync export -m "..."` to keep them in step.
- Don't omit `-m` on `export` if the user wants a meaningful commit message — the default server-generated message is generic.
- Don't `git-sync export` to `main`/`master` without explicit user confirmation — sync work is conventionally on a feature branch. See "Branch guard" above.
- Don't reach for `mb setting set` to mark a collection as remote-synced — that endpoint writes single-key settings, not the bulk `collections` map. Use `mb git-sync add-collection <id>` / `mb git-sync remove-collection <id>` (above), and remember the toggle cascades to descendants.
