import { renderUsage } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { getMetabaseAugment } from "../runtime/command-augment";

export const ANSI_ESC = String.fromCharCode(27);

// Citty's renderUsage prints "<description> (<command name> [v<version>])" as the first
// line; we strip that parenthetical because it duplicates the breadcrumb the user already
// typed to reach this --help.
const BREADCRUMB_SUFFIX = new RegExp(` \\([^()]*\\)(${ANSI_ESC}\\[\\d+m)?\\s*$`);

export async function showUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const raw = await renderUsage(cmd, parent);
  const [first, ...rest] = raw.split("\n");
  const stripped = first === undefined ? "" : first.replace(BREADCRUMB_SUFFIX, "$1");
  const body = [stripped, ...rest].join("\n");
  const examples = getMetabaseAugment(cmd)?.examples ?? [];
  process.stdout.write(body + renderExamples(examples) + renderSchemaHint() + "\n");
}

function renderExamples(examples: readonly string[]): string {
  if (examples.length === 0) {
    return "";
  }
  const lines = ["", "EXAMPLES", ""];
  for (const example of examples) {
    lines.push(`  ${example}`);
  }
  return lines.join("\n");
}

function renderSchemaHint(): string {
  return [
    "",
    "SCHEMA",
    "",
    "  mb __manifest      # machine-readable command tree (flags, output, examples)",
  ].join("\n");
}
