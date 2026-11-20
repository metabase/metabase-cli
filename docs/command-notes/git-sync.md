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
