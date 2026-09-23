import { ValidationError } from "@metabase/client/errors";

import { IMPORT_ROOTS, TreeValidationReport, validateTree } from "../core/schema/validate-tree";
import { writeJson, writeText } from "../output/render";

import { outputFlags } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export { TreeValidationReport };

const STRUCTURAL_NOTE =
  "validation is structural: a file that passes can still name a table, card or collection the instance does not have, or a query it cannot run";

function renderReport(report: TreeValidationReport): string {
  const lines: string[] = [];
  for (const result of report.results) {
    if (result.ok) {
      lines.push(`ok    ${result.file}`);
      continue;
    }
    lines.push(`error ${result.file}`);
    for (const issue of result.errors) {
      lines.push(`  ${issue.path}: ${issue.message}`);
    }
  }
  lines.push(`${report.passed} passed, ${report.failed} failed, ${report.checked} checked`);
  return lines.join("\n");
}

export default defineMetabaseCommand({
  meta: {
    name: "validate",
    description: "Check repository content files against the representation schemas",
  },
  details: `Validates every \`*.yaml\` under the paths given, or with no path under ${IMPORT_ROOTS.map((root) => `\`${root}/\``).join(", ")} in the current directory. The schema is picked by the file's last \`serdes/meta\` entry. Prints one line per file, and with --json the whole report. Exit 1 when any file fails, 2 for a path that is neither a file nor a directory.`,
  skills: [{ skill: "core", purpose: "what is a file and what is a command" }],
  requires: null,
  args: {
    ...outputFlags,
    path: {
      type: "positional",
      description: "A file or directory to check; repeatable (default: the import roots)",
      required: false,
    },
  },
  outputSchema: TreeValidationReport,
  examples: [
    "mb validate",
    "mb validate collections/main/orders.yaml",
    "mb validate collections transforms --json",
  ],
  async run({ args, ctx }) {
    const report = await validateTree(args._, process.cwd());
    if (ctx.format === "json") {
      writeJson(report);
    } else {
      writeText(renderReport(report));
    }
    if (!report.ok) {
      throw new ValidationError(
        `${report.failed} of ${report.checked} file(s) failed validation; ${STRUCTURAL_NOTE}`,
        { source: "validate", zodIssues: [] },
      );
    }
  },
});
