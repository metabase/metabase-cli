import type { Workspace } from "../../contracts/events";

const PARAGRAPH_BREAK = "\n\n";

function branchClause(workspace: Workspace): string {
  return workspace.branch === null ? "on a detached HEAD" : `on branch ${workspace.branch}`;
}

const BRANCH_TEMPLATE = "<branch>";

// A detached checkout has no branch to name yet, so the command is given as a template.
function importLine(workspace: Workspace): string {
  const branch = workspace.branch === null ? BRANCH_TEMPLATE : workspace.branch;
  return `To put the work into the connected Metabase, commit and push the branch, then run \`mb git-sync import --branch ${branch} --wait\`, and prove the result on the instance with the \`mb\` read and run commands.`;
}

// The skills carry the method; this block only has to point at them and state the rule they share.
export function sessionBrief(workspace: Workspace): string {
  return [
    `You are working in a Metabase content repository at ${workspace.path}, ${branchClause(workspace)}.`,
    "Content is files. Collections, cards, dashboards, documents, segments, measures, snippets, transforms and Python libraries are YAML files in the Metabase representation format; nothing creates or changes them through the API.",
    "The connected Metabase's database schema is under `.metadata/databases/`; if it is missing, run `mb metadata extract`. The repository's own `databases/` holds content, not the schema.",
    "`mb` is on PATH and already signed in to the connected Metabase; there is no auth, login or profile command. Before any other `mb` call, run `mb skills get core`, which indexes the other skills. The Metabase method comes from `mb skills` alone: a skill of another source, even one named `rde`, describes a different CLI. Check changed files with `mb validate`.",
    importLine(workspace),
    "Keep scratch notes and state in `.scratch/`.",
  ].join(" ");
}

// A replayed transcript follows the brief, so a conversation cut back by an edit keeps both.
export function systemAppend(brief: string, replay: string | null): string {
  return replay === null ? brief : `${brief}${PARAGRAPH_BREAK}${replay}`;
}
