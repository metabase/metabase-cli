import { DEFAULT_MAX_INTERVAL_MS } from "@metabase/client/poll";
import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

import { defineCommandGroup } from "../group";

const BRANCH_GUARD_FEATURE = "remoteSyncBranchGuard" satisfies FeatureName;

export default defineCommandGroup({
  name: "git-sync",
  description: "Sync Metabase content with a git remote",
  details: [
    "Only admins can run these commands. The server refuses anyone else, and a command that reads the `remote-sync-branch` setting, which only admins see, refuses first (exit 2).",
    "## Import and export use the tracked branch",
    `[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync export-preflight](#mb-git-sync-export-preflight) work on the branch that git-sync tracks: the \`remote-sync-branch\` setting, which the server's \`MB_REMOTE_SYNC_BRANCH\` environment variable can also set. With \`${BRANCH_GUARD_FEATURE}\` (${featureAvailability(BRANCH_GUARD_FEATURE)}), \`import\` refuses (exit 2) when no branch is tracked or the setting isn't readable, with or without \`--branch\`, and so does \`export\` without \`--branch\`. Older servers don't check: \`import\` goes through, and \`export\` writes to the branch the server tracks. On every server, \`export --branch\` refuses when the setting isn't readable, and \`export-preflight\` without \`--branch\` refuses as a guarded \`import\` does, before it contacts the remote.`,
    "## Import, export and stash wait for their task",
    `[mb git-sync import](#mb-git-sync-import), [mb git-sync export](#mb-git-sync-export) and [mb git-sync stash](#mb-git-sync-stash) start a task on the server, wait for it to end, and exit as [mb git-sync wait](#mb-git-sync-wait) does. \`--no-wait\` returns once the task starts. A wait polls first after \`--interval\`, and doubles the delay after each poll, up to ${DEFAULT_MAX_INTERVAL_MS} ms.`,
    "## Don't answer a conflict with a retry",
    "A task that ends in `conflict` names the conflict in its output and its error: the conflicting entities, or, for a plain export, the remote's change since the last sync. The server may then count the remote commit as synced, so a retry, `--merge` included, may not see the remote's changes. Keep the remote's side with `import --force`, keep Metabase's with `export --force`, or keep both through a reviewed PR from a new branch (`mb skills get git-sync`, section \"After a conflict task\").",
  ].join("\n\n"),
  skills: [{ skill: "git-sync", purpose: "import/export round-trip and dirty checks" }],
  subCommands: {
    status: () => import("./status").then((mod) => mod.default),
    "is-dirty": () => import("./is-dirty").then((mod) => mod.default),
    "has-remote-changes": () => import("./has-remote-changes").then((mod) => mod.default),
    dirty: () => import("./dirty").then((mod) => mod.default),
    "current-task": () => import("./current-task").then((mod) => mod.default),
    "cancel-task": () => import("./cancel-task").then((mod) => mod.default),
    wait: () => import("./wait").then((mod) => mod.default),
    import: () => import("./import").then((mod) => mod.default),
    export: () => import("./export").then((mod) => mod.default),
    "export-preflight": () => import("./export-preflight").then((mod) => mod.default),
    stash: () => import("./stash").then((mod) => mod.default),
    branches: () => import("./branches").then((mod) => mod.default),
    "create-branch": () => import("./create-branch").then((mod) => mod.default),
    "add-collection": () => import("./add-collection").then((mod) => mod.default),
    "remove-collection": () => import("./remove-collection").then((mod) => mod.default),
  },
});
