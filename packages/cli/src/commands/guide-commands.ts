import type { CommandDef } from "citty";

import { ConfigError, errorMessage } from "@metabase/client/errors";

import type { Guide } from "../core/guides";
import { codeBlocks, type CodeBlock } from "../core/markdown";
import { shellCommands, type ShellCommand } from "../core/shell-commands";
import { CLI_NAME } from "../runtime/command-help";
import { assertCommandLine } from "./command-line";

const SHELL_LANGUAGES: ReadonlySet<string> = new Set(["sh", "bash", "shell", "zsh"]);
// A command line outside a shell block would go unread, so it is refused rather than skipped.
const COMMAND_LINE = new RegExp(`^\\s*(?:\\$ )?${CLI_NAME}\\s`, "m");

/** Refuses a guide whose shell blocks hold an `mb` command that `root` would not take. */
export async function assertGuideCommands(guide: Guide, root: CommandDef): Promise<void> {
  for (const block of codeBlocks(guide.body)) {
    if (block.language === null || !SHELL_LANGUAGES.has(block.language)) {
      assertNoCommandLine(block, guide);
      continue;
    }
    for (const command of readShellBlock(block, guide)) {
      await assertShellCommand(command, guide, root);
    }
  }
}

function assertNoCommandLine(block: CodeBlock, guide: Guide): void {
  if (COMMAND_LINE.test(block.text)) {
    throw new ConfigError(
      `${guide.file} line ${block.firstLine - 1}: the code block holds an ${CLI_NAME} command, so mark it sh: only a shell block's commands are checked`,
    );
  }
}

function readShellBlock(block: CodeBlock, guide: Guide): ShellCommand[] {
  try {
    return shellCommands(block.text, block.firstLine);
  } catch (error) {
    throw new ConfigError(`${guide.file} ${errorMessage(error)}`);
  }
}

async function assertShellCommand(
  command: ShellCommand,
  guide: Guide,
  root: CommandDef,
): Promise<void> {
  const where = `${guide.file} line ${command.line}`;
  const [name, ...argv] = command.words;
  if (name !== CLI_NAME) {
    if (argv.includes(CLI_NAME)) {
      throw new ConfigError(
        `${where}: ${name} runs ${CLI_NAME}, which is checked only as a command of its own`,
      );
    }
    return;
  }
  try {
    await assertCommandLine(root, argv);
  } catch (error) {
    throw new ConfigError(`${where}: ${errorMessage(error)} (${command.words.join(" ")})`);
  }
}
