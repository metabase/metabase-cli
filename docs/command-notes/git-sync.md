## Only admins can sync

The git-sync commands import and export Metabase content against the git remote that an admin set up. The server refuses anyone who isn't an admin.

## Import and export use the tracked branch

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync export-preflight](#mb-git-sync-export-preflight) work on the branch that git-sync tracks: the `remote-sync-branch` setting, which the server's `MB_REMOTE_SYNC_BRANCH` environment variable can also set. On Metabase 63 and newer, `import` and `export` without `--branch` refuse (exit 2) when no branch is tracked or the setting isn't readable. Older servers don't check: `import` goes through, and `export` writes to the branch the server tracks. `export-preflight` without `--branch` refuses the same way on every server, before it contacts the remote.

## Import, export and stash wait for their task

[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync stash](#mb-git-sync-stash) start a task on the server, wait for it to end, and exit as [mb git-sync wait](#mb-git-sync-wait) does. `--no-wait` returns once the task starts.

## Don't answer a conflict with a retry

A task that ends in `conflict` names the conflict in its output and its error: the conflicting entities, or, for a plain export, the remote's change since the last sync. The server may then count the remote commit as synced, so a retry, `--merge` included, may not see the remote's changes. Keep the remote's side with `import --force`, keep Metabase's with `export --force`, or keep both through a reviewed PR from a new branch (`mb skills get git-sync`, section "After a conflict task").
