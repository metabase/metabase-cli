import { dirname } from "node:path";

import { errorMessage } from "@metabase/client/errors";

import type { ActionOutcome, OpenedExternally } from "../contracts/changes";

import { testModeEnabled } from "./ipc";
import type { StartProcess } from "./process/spawn";

const WORD_SEPARATOR = /\s+/;

interface SystemShell {
  readonly openExternal: (url: string) => Promise<void>;
  readonly openPath: (path: string) => Promise<string>;
}

interface SystemOpenerDeps {
  readonly shell: SystemShell;
  readonly editor: () => string | null;
  readonly startProcess: StartProcess;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (message: string) => void;
}

interface SystemOpener {
  readonly kind: "system";
  readonly openUrl: (url: string) => Promise<boolean>;
  readonly openFile: (path: string) => Promise<ActionOutcome>;
}

interface RecordingOpener {
  readonly kind: "recording";
  readonly openUrl: (url: string) => Promise<boolean>;
  readonly openFile: (path: string) => Promise<ActionOutcome>;
  readonly opened: () => OpenedExternally;
}

export type ExternalOpener = SystemOpener | RecordingOpener;

function openInEditor(deps: SystemOpenerDeps, editor: string, path: string): ActionOutcome {
  const [command, ...args] = editor.trim().split(WORD_SEPARATOR);
  if (command === undefined || command.length === 0) {
    return { kind: "refused", message: "The editor setting names no command." };
  }
  const started = deps.startProcess({
    command,
    args: [...args, path],
    env: deps.env,
    cwd: dirname(path),
  });
  if (started.kind === "start-failed") {
    return { kind: "refused", message: `${command} could not be started: ${started.message}` };
  }
  void started.exited.then((exit) => {
    if (exit.kind === "failed") {
      deps.log(`editor: ${command} failed: ${exit.message}`);
    }
  });
  return { kind: "done" };
}

function systemOpener(deps: SystemOpenerDeps): SystemOpener {
  return {
    kind: "system",
    openUrl: async (url) => {
      try {
        await deps.shell.openExternal(url);
        return true;
      } catch (error) {
        deps.log(`open: no browser opened ${url}: ${errorMessage(error)}`);
        return false;
      }
    },
    openFile: async (path) => {
      const editor = deps.editor();
      if (editor !== null) {
        return openInEditor(deps, editor, path);
      }
      const failure = await deps.shell.openPath(path);
      return failure.length === 0 ? { kind: "done" } : { kind: "refused", message: failure };
    },
  };
}

function recordingOpener(): RecordingOpener {
  const urls: string[] = [];
  const paths: string[] = [];
  return {
    kind: "recording",
    openUrl: async (url) => {
      urls.push(url);
      return true;
    },
    openFile: async (path) => {
      paths.push(path);
      return { kind: "done" };
    },
    opened: () => ({ urls: [...urls], paths: [...paths] }),
  };
}

export function externalOpener(deps: SystemOpenerDeps): ExternalOpener {
  return testModeEnabled(deps.env) ? recordingOpener() : systemOpener(deps);
}
