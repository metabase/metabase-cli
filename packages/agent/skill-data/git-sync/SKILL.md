---
name: git-sync
description: Round-trip Metabase content (cards, dashboards, transforms, snippets, collections, Library-published table/field metadata) between an instance and a git remote with the `git_sync` tool — status, import, export (with branch guard), branches, stash, add/remove a collection from sync. Load when the user wants to "import the latest changes", "export to git", "push my changes to the repo", "open a PR with my Metabase changes", "git sync", "dirty check", "stash before pivoting", or "add a collection to sync".
---

# git-sync (representations ↔ instance)

Metabase content (cards, dashboards, transforms, snippets, collections, …) lives in a git repo as YAML and round-trips in and out of a Metabase instance. The instance is configured with a `remote-sync-*` settings block (URL, branch, token, type read-only/read-write), and `git_sync` drives the sync tasks. **Only collections flagged for sync serialize; everything else is local-only.** Table and field metadata round-trips too, for Library-published tables in a flagged collection — see "Published table metadata" below.

The repo and the instance are two ends of the same state, and content crosses between them in exactly one way: a sync task. `export` writes the instance's state out to the remote; `import` reads the remote's state in. So "push my changes" / "save this to the repo" / "open a PR with these changes", when the changes were made **in the instance** (cards edited, transforms created, tables published, metadata written), means exporting to a branch — `stash` onto a fresh branch, or `create_branch` then `export` — and opening the PR from that branch. There is no second path: the repo's YAML uses **name-based** references (`[Sample Database, PUBLIC, ORDERS, TOTAL]`, entity-ids for cross-entity FKs) where the API form uses numeric ids, and files in paths or formats the serializer doesn't own are invisible to Metabase and never apply on import.

For the shapes inside that YAML: query bodies follow the `mbql` skill, `visualization_settings` follow the `visualization` skill, transform definitions the `transform` skill.

## Precondition: read state before mutating

Always read `status` before `import` or `export`. Importing onto a dirty instance is rejected unless you set `force`; exporting when the instance is behind the remote pushes a stale state.

```
{action: "status"}
```

One call answers the four facts every other action depends on:

| Field                             | Means                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `branch`                          | The tracked branch (the `remote-sync-branch` setting). `null` if unconfigured. |
| `is_dirty` / `dirty_items`         | The instance has changes the remote does not — each item is `{id, name, model, sync_status, collection_id}`. |
| `remote_has_changes`              | The remote has commits the instance has not imported. `remote_version` / `local_version` are the two sides. |
| `current_task`                    | The in-flight sync task, or `null` when idle: `{id, sync_task_type, status, progress, version, error_message}`. |
| `synced_collections`              | The sync scope — `{id, name}` per flagged collection. Nothing outside this list travels. |

**Clean up before exporting.** If you've created entities you intend to delete (a failed transform you're going to retry, a card you authored to test a body shape, a draft dashboard) — do the deletes _before_ the first `export`. Once committed, the cleanup needs a second commit, and the failed entity stays visible in the repo's history forever. For transforms, prefer updating the existing transform over delete + create (see the `transform` skill).

## Import (remote → instance)

```
{action: "import", branch: "feature/finance"}
```

Pulls the branch and applies it to the instance, blocking until the task reaches a terminal state (`successful`, `errored`, `cancelled`, `timed-out`, `conflict`).

| Argument     | Purpose                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `branch`     | The branch to import from. Defaults to the configured `remote-sync-branch`, which `status` reports. |
| `force`      | **Discards the instance's dirty changes** (lossy — the items `status` listed are gone for good). Confirm with the user first. |
| `wait`       | `false` returns as soon as the task is queued; the outcome is then unknown and nothing re-checks it for you. Default `true`. |
| `timeout_ms` | How long to block. On expiry the task keeps running server-side. |

When the instance is already at the remote's version, the result is `{imported: false}` with the server's message — no task runs.

Workflow:

1. `{action: "status"}` — confirm `is_dirty: false` (or that `force` is intended).
2. Confirm `remote_has_changes: true` — there is actually something to import.
3. `{action: "import", branch: "<branch>"}` — runs to terminal status.

## Export (instance → remote)

```
{action: "export", message: "Add finance dashboards"}
```

Pushes the instance's changes back to the remote. Without `message` the server picks a generic default — pass one whenever the user cares what the commit says.

| Argument     | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `branch`     | Push to a specific branch instead of the configured one.       |
| `message`    | The commit message.                                            |
| `force`      | Force-pushes, overwriting the remote branch's history. Confirm with the user. |
| `wait`       | `false` returns once queued.                                   |
| `timeout_ms` | Blocking deadline.                                             |

Workflow:

1. **Branch guard** (below) — confirm the instance isn't tracking `main`/`master`, or that the user has explicitly accepted exporting to it.
2. `{action: "status"}` — confirm `is_dirty: true`, so there is something to export.
3. `{action: "export", message: "..."}` — pushes and blocks to terminal status.
4. `{action: "status"}` — verify `is_dirty: false` after.

### Branch guard: don't export to main/master without confirmation

Sync work is conventionally done on a feature branch — exporting to `main` (or `master`) commits team-shared content straight to it. Read `branch` from `status` before every export.

If it is `main` or `master`, ask the user:

> "The instance is tracking `<branch>` — exporting commits straight to it. Switch to a feature branch first?"
>
> 1. **Create a feature branch** — suggest a name (e.g. `agent/<task>`), then `{action: "create_branch", name: "<name>"}`. That switches the instance's tracked branch to it, and every subsequent `export` goes there.
> 2. **Proceed on `main`/`master`** — explicitly accepted.

Skip the question only if the user's instructions already named the branch (they said "export to main", or named a feature branch). Don't silently default to whatever `remote-sync-branch` happens to point at.

## Branches

```
{action: "branches"}                                              # the remote's branches
{action: "create_branch", name: "agent/finance-metrics"}          # create + switch sync to it
{action: "stash", new_branch: "agent/wip", message: "WIP"}        # export current state onto a NEW branch
```

`stash` requires `new_branch`. It is the safe move when the instance holds team work you don't want to lose but you need to pivot to a different branch: `import` would discard it, `export` with `force` would overwrite the remote. `stash` exports the current state onto a fresh branch first, so the work is committed somewhere before you move.

## Waiting and conflicts

`import`, `export` and `stash` block to a terminal status by default and return the finished task. Set `wait: false` to return as soon as the task is queued — then the only way back to the outcome is `{action: "status"}`, which reports `current_task`. Raise `timeout_ms` for a large repo rather than abandoning the wait: a timeout does not stop the task, it only stops the blocking.

A task that ends in `conflict` means the same content changed on both sides. Resolving it means discarding one side's version — ask the user which side wins before reaching for `force`, and never set `force` merely to clear the conflict.

## Adding / removing a directory (collection) to sync

The set of directories under sync is governed by which **collections** carry `is_remote_synced: true`. Every collection so flagged serializes to its own folder under `collections/` in the repo; everything outside that set is local-only.

```
{action: "add_collection", collection_id: 12}
{action: "remove_collection", collection_id: 12}
```

`collection_id` is a **positive integer** — nano-id / `root` / `trash` references are not accepted. Find the id with `browse_collection` (`{id: "root", mode: "tree"}`) or `search`.

Both actions return `{success: true, task_id?: <id>}`. The optional `task_id` appears only when the toggle triggered a follow-up task (e.g. a finalization import after switching to read-only mode); for a normal add/remove in read-write, expect `{success: true}` and nothing else.

**Cascade.** A toggle on a parent cascades to every descendant by location prefix — `add_collection` on `4` flips `4` plus every collection nested under it, and `remove_collection` on `4` is the symmetric inverse. There is no per-leaf-only mode.

**Mode prerequisite.** The server rejects toggles while `remote-sync-type` is `read-only` (the install default). If `add_collection` comes back with `Cannot change synced collections when remote-sync-type is read-only.`, switch first:

```
{action: "set", key: "remote-sync-type", value: "read-write"}      # instance_settings
```

The server also rejects switching **to** `read-only` while the Remote Sync collection is dirty — export first (or import with `force`) if you're going the other way.

**Verifying the result.** `{action: "status"}` lists the flagged collections under `synced_collections`, and `get_content` on the collection (`{items: [{type: "collection", id: 12}]}`) shows its `is_remote_synced` flag.

## Published table metadata (Library) and sync scope

Table and field metadata — table/field descriptions, semantic types (`type/PK`, `type/FK`), FK targets, plus segments and measures on the table — serializes for **Library-published tables only**, under `databases/<db>/schemas/<schema>/tables/<table>/…` in the repo. Eligibility is two-gated: the table must be published (`library` tool, `{action: "publish", table_ids: [...]}`), **and** the Library collection holding it must itself carry `is_remote_synced: true`. An ordinary warehouse table, or a transform's target table that isn't published, never serializes — a transform's YAML carries only the transform definition (query, target, description), not the output table's field metadata.

The classic trap: publish tables, write field metadata, then `status` reports no dirty items and nothing lands in the repo. That does not mean git-sync can't carry table metadata — it means the Library collection isn't in the sync scope, so nothing was eligible for dirty-tracking when the writes happened. Check the scope (`synced_collections` in `status`), then:

```
{action: "get"}                                                    # library — the Library Data collection id
{action: "add_collection", collection_id: <library-data-id>}       # git_sync
{action: "stash", new_branch: "agent/library-metadata", message: "Publish finance tables"}
```

Flagging the collection records it for the next export, which serializes its current content — including already-published tables and their field metadata.

## Don't (git-sync-specific)

- Don't conclude from an empty `dirty_items` list that a change type isn't tracked. Dirty-tracking only records changes to _eligible_ objects; the usual cause is scope (the collection isn't flagged — see "Published table metadata"), not capability. Check `synced_collections` in `status` before concluding.
- Don't set `force` on `import` or `export` without explicit user confirmation. Both are lossy — `force` on import discards the instance's work, `force` on export overwrites the remote branch.
- Don't drive `git_sync` against an instance that has no remote-sync configured — every action returns an error pointing at the missing `remote-sync-*` settings. To check: `instance_settings` `{action: "get", key: "remote-sync-url"}`.
- Don't author content with `question_write` / `transform_write` and then assume a later `export` will commit it cleanly — the instance and repo drift when direct writes are mixed with sync-tracked ones over a long session. Follow a batch of writes with `{action: "export", message: "..."}` to keep the two in step.
- Don't omit `message` on `export` when the user cares about the commit — the server's default message is generic.
- Don't `export` to `main`/`master` without explicit user confirmation. See "Branch guard" above.
- Don't reach for `instance_settings` to mark a collection as remote-synced — that surface writes single-key settings, not the sync scope. Use `{action: "add_collection", collection_id: <id>}` / `{action: "remove_collection", collection_id: <id>}`, and remember the toggle cascades to descendants.
