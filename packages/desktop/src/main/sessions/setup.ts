import { access, constants } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "@metabase/client/errors";

import type { SessionEventInput } from "../../contracts/events";
import type { StartProcess } from "../process/spawn";

export const SETUP_SCRIPT_PATH = [".rde", "setup"];

const SETUP_LABEL = "Prepare the worktree";

export interface SetupRequest {
  readonly repositoryRoot: string;
  readonly cwd: string;
  readonly note: string | null;
  readonly env: NodeJS.ProcessEnv;
  readonly startProcess: StartProcess;
  readonly emit: (event: SessionEventInput) => Promise<void>;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly eventId: () => string;
  readonly now: () => string;
}

async function executableScript(repositoryRoot: string): Promise<string | null> {
  const path = join(repositoryRoot, ...SETUP_SCRIPT_PATH);
  try {
    await access(path, constants.X_OK);
    return path;
  } catch {
    return null;
  }
}

function readLines(stream: NodeJS.ReadableStream, into: (text: string) => void): void {
  stream.on("data", (chunk: Buffer) => {
    into(chunk.toString("utf8"));
  });
}

// The row exists only when the app has something to say about the checkout: a script the project
// ships, or a fetch that could not reach the remote.
export async function runSetupScript(request: SetupRequest): Promise<void> {
  const script = await executableScript(request.repositoryRoot);
  if (script === null && request.note === null) {
    return;
  }
  const scope = {
    id: request.eventId(),
    sessionId: request.sessionId,
    at: request.now(),
    turnId: request.turnId,
    callId: request.callId,
  };
  await request.emit({
    ...scope,
    type: "tool.started",
    tool: "command",
    label: SETUP_LABEL,
    input: { script, cwd: request.cwd },
  });

  const report = (text: string): Promise<void> =>
    request.emit({
      id: request.eventId(),
      sessionId: request.sessionId,
      at: request.now(),
      turnId: request.turnId,
      type: "tool.updated",
      callId: request.callId,
      progress: { kind: "output", text },
    });

  if (request.note !== null) {
    await report(`${request.note}\n`);
  }

  const outcome = script === null ? null : await runScript(request, script, report);
  if (outcome !== null) {
    await report(`${outcome.summary}\n`);
  }
  await request.emit({
    id: request.eventId(),
    sessionId: request.sessionId,
    at: request.now(),
    turnId: request.turnId,
    type: "tool.completed",
    callId: request.callId,
    status: outcome === null || outcome.ok ? "ok" : "error",
    output: "",
    files: [],
    patch: null,
  });
}

interface ScriptOutcome {
  readonly ok: boolean;
  readonly summary: string;
}

async function runScript(
  request: SetupRequest,
  script: string,
  report: (text: string) => Promise<void>,
): Promise<ScriptOutcome> {
  const started = request.startProcess({
    command: script,
    args: [],
    env: request.env,
    cwd: request.cwd,
  });
  if (started.kind === "start-failed") {
    return { ok: false, summary: `${script} could not be run: ${started.message}` };
  }
  const forward = (text: string): void => {
    void report(text);
  };
  readLines(started.stdout, forward);
  readLines(started.stderr, forward);
  try {
    const exit = await started.exited;
    if (exit.kind === "failed") {
      return { ok: false, summary: `${script} failed: ${exit.message}` };
    }
    if (exit.code !== 0) {
      return { ok: false, summary: `${script} exited ${String(exit.code)}.` };
    }
    return { ok: true, summary: `${script} finished.` };
  } catch (error) {
    return { ok: false, summary: `${script} failed: ${errorMessage(error)}` };
  }
}
