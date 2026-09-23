import type { CommandHelpIndex } from "../runtime/command-help";

// The whole leaf surface, in help order. `help --json` at the root and the README's command
// table are both held to this list.
export const COMMAND_SURFACE = [
  "db list",
  "db get",
  "db schemas",
  "db schema-tables",
  "db sync-schema",
  "db rescan-values",
  "table list",
  "table get",
  "table fields",
  "field get",
  "field values",
  "field summary",
  "card list",
  "card get",
  "card query",
  "dashboard list",
  "dashboard get",
  "dashboard cards",
  "dashboard parameter-values",
  "collection list",
  "collection get",
  "collection items",
  "collection tree",
  "library get",
  "library publish",
  "library unpublish",
  "document list",
  "document get",
  "transform list",
  "transform get",
  "transform dependencies",
  "transform run",
  "transform cancel",
  "transform get-run",
  "transform runs",
  "transform-job list",
  "transform-job get",
  "transform-job run",
  "transform-job transforms",
  "transform-tag list",
  "transform-test list",
  "transform-test get",
  "transform-test create",
  "transform-test update",
  "transform-test delete",
  "transform-test run",
  "metadata extract",
  "search",
  "git-sync status",
  "git-sync tree",
  "git-sync is-dirty",
  "git-sync has-remote-changes",
  "git-sync dirty",
  "git-sync current-task",
  "git-sync cancel-task",
  "git-sync wait",
  "git-sync import",
  "git-sync branches",
  "git-sync worktree list",
  "git-sync worktree ensure",
  "git-sync worktree delete",
  "snippet list",
  "snippet get",
  "segment list",
  "segment get",
  "measure list",
  "measure get",
  "eid",
  "entity-id",
  "query",
  "uuid",
  "validate",
  "skills list",
  "skills get",
  "skills path",
] as const;

const COMMAND_HEADING = "Command";
const DESCRIPTION_HEADING = "What it does";

function padded(cells: readonly string[], widths: readonly number[]): string {
  return `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
}

// Columns are padded the way the formatter lays a Markdown table out, so the README holds this
// text verbatim.
export function renderSurfaceTable(entries: CommandHelpIndex["commands"]): string {
  const rows = entries.map((entry) => [`\`mb ${entry.command}\``, entry.description ?? ""]);
  const heading = [COMMAND_HEADING, DESCRIPTION_HEADING];
  const widths = heading.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const separator = widths.map((width) => "-".repeat(width));
  return [
    padded(heading, widths),
    padded(separator, widths),
    ...rows.map((row) => padded(row, widths)),
  ].join("\n");
}
