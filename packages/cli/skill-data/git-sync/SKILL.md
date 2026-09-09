---
name: git-sync
description: Round-trip Metabase content (cards, dashboards, transforms, snippets, collections, Library-published table/field metadata) between an instance and a git remote via `mb git-sync …` — status, dirty / has-remote-changes checks, import, export (with branch guard), branches, stash, add/remove a collection from sync. Load when the user wants to "import the latest changes", "export to git", "push my changes to the repo", "open a PR with my Metabase changes", "git sync", "dirty check", "stash before pulling", "add a collection to sync", or anything `mb git-sync …` / `mb worktree …`. Also covers worktrees — isolated per-branch checkouts of transforms and other content — for "work on this branch in isolation", "create a worktree", "pin the profile to a worktree", "export the worktree and open a PR".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# git-sync (representations ↔ instance)

Metabase content (cards, dashboards, transforms, snippets, collections, …) can live in a git repo as YAML and round-trip in and out of a Metabase instance via the `git-sync` verbs. The instance is configured with a `remote-sync-*` settings block (URL, branch, token, type read-only/read-write); the CLI drives the sync tasks against `/api/ee/remote-sync/*`. Only collections flagged for sync serialize; everything else is local-only. Table and field metadata round-trips too, for Library-published tables in a flagged collection — see "Published table metadata" below.

The repo and the instance are two ends of the same state; what "push my changes" means depends on where the changes were made. If they were made **in the instance** (CLI verbs against a read-write instance — cards edited, transforms created, tables published, metadata written), "push my changes" / "save this to the repo" / "open a PR with these changes" means driving the instance's export to a branch (`stash` or `create-branch` + `export`) and opening the PR from that branch — not reconstructing the changes as files. If the workflow is **repo-first** (content YAML edited in the repo, the instance imports it), plain `git` against the repo is the way — but only in the serialized layout already there: files in paths or formats the serializer doesn't own are invisible to Metabase and never apply on import.

This skill covers the import/export workflow. Flag conventions and auth setup live in `core` (`mb skills get core`). To author content YAML by hand: the per-resource clause and settings shapes mirror the API form — query bodies follow the `mbql` skill, `visualization_settings` follow the `visualization` skill — except the portable YAML uses **name-based** references (e.g. `[Sample Database, PUBLIC, ORDERS, TOTAL]`, and entity-ids for cross-entity FKs) where the API form uses numeric ids. For the on-disk folder layout, model new files on what the synced repo already contains.

## Precondition: read state before mutating

Always run `status` (or `is-dirty` + `has-remote-changes`) before `import` or `export`. Importing on a dirty instance silently rejects unless you pass `--force`; exporting when the instance is behind the remote pushes a stale state.

```bash
mb git-sync status              --profile <n> --json   # → branch, dirty, current task
mb git-sync is-dirty            --profile <n> --json   # → {is_dirty: bool}; instance has unexported changes
mb git-sync has-remote-changes  --profile <n> --json   # → {has_changes: bool, remote_version, local_version, cached}; remote has unimported commits
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
| `--merge`         | Three-way merge remote changes instead of failing on divergence. Confirm first.      |
| `--timeout <ms>`  | Polling deadline. Default 600 000.                                                   |
| `--interval <ms>` | Polling cadence. Default 2 000.                                                      |

Workflow:

1. Read state (above) — confirm `is_dirty: false` (or `--force` is intended).
2. Confirm `has-remote-changes` reports `has_changes: true` — there's actually something to import.
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
| `--merge`           | Three-way merge instead of failing on divergence.        |
| `--no-wait`         | Don't poll.                                              |

Workflow:

1. **Branch guard** (below) — confirm the instance isn't tracking `main`/`master`, or that the user has explicitly accepted exporting to it.
2. Read state (above) — confirm `is-dirty` reports there's something to export.
3. `git-sync export -m "..."` — pushes and polls.
4. (Optional) `git-sync status` — verify `is_dirty: false` after.

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

## Worktrees (isolated branch checkouts)

A **worktree** is a self-contained checkout of one branch's content inside the same instance. Transforms, transform tags, snippets, `transforms`-namespace collections, the Library, cards, dashboards, and documents are tagged with the worktree's id; tables and fields stay shared with the main app. It is how a chain of transforms gets built, exported, and reviewed as a PR without touching production content. Admin-only, and needs Metabase v64+ with the `remote_sync` feature.

Two hard limits, up front:

- **A worktree's transforms cannot be run.** `mb transform run` refuses while a worktree scope is in force, and the server rejects the run anyway. There is no workaround to find — run the transform in the main app after the branch is merged and imported, and say so rather than trying to validate the SQL by running it in the worktree.
- **A worktree is bound to its branch for life.** No branch switching inside one; a different branch means a different worktree.

### Where am I? Check before touching import/export

```bash
mb auth status --profile <n> --json | jq '.worktree'      # {id, branch} when the profile is pinned, else null
mb git-sync status --profile <n> --json | jq '.worktree'  # the scope this command ran under
mb worktree list --profile <n> --json                     # every worktree on the instance
```

A pinned profile pushes to the worktree's branch; an unpinned one pushes to whatever `remote-sync-branch` points at. Confusing the two is how worktree work lands on the team's tracked branch, so read the pin before the first `export`.

### Preconditions before creating one

1. **The user named the branch.** Create a worktree only for a branch the user asked you to work on.
2. **A branch holds at most one worktree.** Check `mb worktree list --json` first; a duplicate fails with the server's `A worktree for branch '<b>' already exists.` — reuse it with `mb worktree pin <branch>` instead.
3. **A pinned profile is already confined.** `mb worktree create` for any other branch is refused, because a second worktree from a pinned session would escape the pin.

### The workflow

```bash
# 1. Create the worktree and pin the profile to it. Mints the branch on the remote when missing
#    (--no-checkout, so the main app's tracked branch is untouched), then pulls the branch in.
mb worktree create feat/order-metrics --pin --profile <n> --json

# 2. Edit transforms. Scoped commands need no extra flag once the profile is pinned.
mb transform create --file ./.scratch/transform.json --profile <n> --json
mb transform list --profile <n> --json        # only this worktree's transforms
mb transform update <id> --file ./.scratch/patch.json --profile <n> --json

# 3. Read state before pushing — same rule as the main app.
mb git-sync status --profile <n> --json       # branch, dirty flag, current task, all scoped
mb git-sync dirty  --profile <n> --json       # exactly what will be committed

# 4. Dry-run the push, read the answer, then push.
mb git-sync export-preflight --profile <n> --json
mb git-sync export -m "add order metrics transforms" --profile <n>

# 5. Open the PR from the branch with plain git / gh, and let a human review and merge it.

# 6. Retire the worktree once the PR is merged. This clears the pin it was holding.
mb worktree delete feat/order-metrics --profile <n> --json
```

`export-preflight` answers `{has_changes, clean, conflicts, summary: {added, updated, removed}, force_push_casualties: {deleted, overwritten}, reason}`. Read it before every worktree export: `clean: true` with empty `conflicts` is a push that applies as-is; a non-empty `conflicts` or `force_push_casualties` is a conversation with the user, not a `--force`.

The main app pulls the merged branch from a **different, unpinned** profile — `git-sync import` into the main app and `transform run` are both main-app operations and a pinned profile refuses them:

```bash
mb git-sync import --profile <main-app-profile>
mb transform run <id> --wait --profile <main-app-profile> --json
```

### Scope precedence and what a pinned profile refuses

The scope comes from `--worktree <id|branch>`, else `MB_WORKTREE`, else the profile's pin. **The pin is a lock, not a default:** while it stands, the flag and the env var may only re-state it, and naming a different worktree exits 2 with `profile "<p>" is pinned to worktree <id> (<branch>); refusing --worktree <x>`.

Under a scope, a command that changes or runs main-app state refuses before any request and exits 2 — `transform run` / `cancel`, `card` / `library` writes, and the main-app git-sync verbs `stash`, `create-branch`, `add-collection`, `remove-collection`:

```
transform run is not available inside a worktree (scope: worktree 3 (feat/order-metrics) from the profile pin); it changes main-app content. Unpin the profile (`mb worktree unpin`) or drop MB_WORKTREE to run it against the main app.
```

Two more refusals belong to the scope:

- Fetching a row that lives elsewhere: `transform 12 is not in worktree 3 (feat/order-metrics); refusing to touch main-app content`.
- `--branch` on `import` / `export` / `export-preflight`: `a worktree is pinned to its branch; drop --branch`.

### Confirmations these flags need

- `--force` (on `import`, `export`, and `worktree delete`) and `--merge` (on `import` / `export`) are **lossy or history-rewriting** — ask the user first, with `AskUserQuestion`, naming what gets discarded. `export-preflight`'s `force_push_casualties` is the list to show them.
- `mb worktree delete` refuses a worktree holding unpushed changes: `worktree <id> (<branch>) has unpushed changes; push them with mb git-sync export or pass --force to discard`. Export first, or ask before forcing — the content in a worktree exists nowhere else once it is gone.

### Don't (worktrees)

- **Don't unpin to reach the main app.** The pin is the isolation boundary a harness put there; `mb worktree unpin` to get past a refusal turns an isolated session into one that can write production content. Report the refusal and what you would need instead.
- **Don't run a worktree's transforms**, and don't route around the refusal with `mb query`, a native card, or a second profile. Validate the query shape with `--dry-run` (see `mbql`) and run it for real in the main app after the merge.
- **Don't create worktrees for branches you were not asked to touch.** A worktree checks a whole branch's content into the instance; an unwanted one is content to clean up, not a free experiment.
- **Don't `git-sync export` from the main app while the work lives in a worktree.** It pushes the main app's state to the tracked branch and the worktree's edits are not in it. Check `.worktree` in `git-sync status` before exporting.
- **Don't hand-write the branch's YAML in the repo to "help" the PR.** Worktree content round-trips through `export` exactly like main-app content — see the first entry of the general "Don't" list below.

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

**Verifying the result.** `mb git-sync status --profile <n> --json` lists the flagged collections under `synced_collections`, and `mb collection get <id> --json` shows the per-collection `is_remote_synced` flag.

## Published table metadata (Library) and sync scope

Table and field metadata — table/field descriptions, semantic types (`type/PK`, `type/FK`), FK targets, plus segments and measures on the table — serializes for **Library-published tables only**, under `databases/<db>/schemas/<schema>/tables/<table>/…` in the repo. Eligibility is two-gated: the table must be published (`mb library publish`), **and** the Library collection holding it must itself carry `is_remote_synced: true`. An ordinary warehouse table, or a transform's target table that isn't published, never serializes — a transform's YAML carries only the transform definition (query, target, description), not the output table's field metadata.

The classic trap: publish tables, write field metadata, then `git-sync dirty` comes back empty and nothing lands in the repo. That does not mean git-sync can't carry table metadata — it means the Library collection isn't in the sync scope, so nothing was eligible for dirty-tracking when the writes happened. Check the scope (`synced_collections` in `status`), then:

```bash
mb library get --profile <n> --json                                # Library Data collection id
mb git-sync add-collection <library-data-id> --profile <n>
mb git-sync stash --new-branch <branch> -m "..." --profile <n>     # or create-branch + export
```

Flagging the collection records it for the next export, which serializes its current content — including already-published tables and their field metadata. `mb library publish` prints a reminder when the target collection is outside the sync scope on an instance with a configured remote.

## Don't (git-sync-specific)

- Don't turn instance-side changes into hand-written repo files. When the changes were made against the instance, export them (`stash` / `create-branch` + `export`) and PR the exported branch; reconstructing them as YAML by hand — or pushing files in paths/formats the serializer doesn't own — produces content that never applies on import, and pushing behind Metabase's back races its own sync tasks. Hand-editing YAML belongs to the repo-first workflow, in the serialized layout the repo already uses.
- Don't conclude from an empty `dirty` list that a change type isn't tracked. Dirty-tracking only records changes to _eligible_ objects; the usual cause is scope (the collection isn't flagged — see "Published table metadata"), not capability. Check `synced_collections` in `status` before concluding.
- Don't run `git-sync import --force` or `git-sync export --force` without explicit user confirmation. Both are lossy — `--force` import discards instance-side work, `--force` export overwrites the remote branch.
- Don't drive `git-sync` against a Metabase instance that doesn't have remote-sync configured — every verb returns an error pointing at the missing `remote-sync-*` settings. To check: `mb setting get remote-sync-url --profile <n> --json`.
- Don't author content directly via `card create` / `transform create` and then assume `git-sync export` will commit it cleanly — the instance and repo can drift if you mix direct API writes with sync-tracked changes. If you do, follow direct writes immediately with `git-sync export -m "..."` to keep them in step.
- Don't omit `-m` on `export` if the user wants a meaningful commit message — the default server-generated message is generic.
- Don't `git-sync export` to `main`/`master` without explicit user confirmation — sync work is conventionally on a feature branch. See "Branch guard" above.
- Don't reach for `mb setting set` to mark a collection as remote-synced — that endpoint writes single-key settings, not the bulk `collections` map. Use `mb git-sync add-collection <id>` / `mb git-sync remove-collection <id>` (above), and remember the toggle cascades to descendants.
