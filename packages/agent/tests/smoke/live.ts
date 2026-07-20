import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { createMetabaseConnection, type MetabaseConnection } from "../../src/metabase/connection";
import { type InstanceContext, probeInstance } from "../../src/metabase/probe";
import { type AgentModel, hasProviderKey, resolveAgentModel } from "../../src/models";
import { createMetabaseAgentSession } from "../../src/session";

export const AGENT_TIMEOUT_MS = 300_000;

const BashArgs = z.object({ command: z.string() }).loose();

export interface Live {
  connection: MetabaseConnection;
  instance: InstanceContext;
  model: AgentModel;
}

export interface ToolCall {
  name: string;
  args: unknown;
}

export interface AgentRun {
  toolCalls: ToolCall[];
  text: string;
}

// The smokes are the provider matrix: whichever model `AGENT_MODEL` names is the one under test.
// No key at all means "not a model run" and the suite skips; a key that names a broken model is a
// configuration error and resolveAgentModel throws, failing the run.
export async function resolveLive(): Promise<Live | null> {
  const hasInstance =
    process.env["MB_URL"] !== undefined && process.env["MB_API_KEY"] !== undefined;
  if (!hasInstance || !hasProviderKey(process.env)) {
    return null;
  }
  const model = resolveAgentModel({ env: process.env });
  const connection = await createMetabaseConnection();
  const instance = await probeInstance(connection.client, connection.url);
  return { connection, instance, model };
}

const scratchDirs: string[] = [];

export async function cleanupScratch(): Promise<void> {
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  scratchDirs.length = 0;
}

export async function runAgent(live: Live, prompt: string): Promise<AgentRun> {
  const cwd = await mkdtemp(join(tmpdir(), "mb-agent-smoke-"));
  scratchDirs.push(cwd);
  const session = await createMetabaseAgentSession({
    cwd,
    model: live.model,
    client: live.connection.client,
    instance: live.instance,
  });
  const run: AgentRun = { toolCalls: [], text: "" };
  try {
    collect(session, run);
    await session.prompt(prompt);
    if (session.agent.state.errorMessage !== undefined) {
      throw new Error(session.agent.state.errorMessage);
    }
    return run;
  } finally {
    session.dispose();
  }
}

function collect(session: AgentSession, run: AgentRun): void {
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      run.toolCalls.push({ name: event.toolName, args: event.args });
    } else if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      run.text += event.assistantMessageEvent.delta;
    }
  });
}

export function toolNames(run: AgentRun): string[] {
  return run.toolCalls.map((call) => call.name);
}

export function bashCommands(run: AgentRun): string[] {
  return run.toolCalls
    .filter((call) => call.name === "bash")
    .map((call) => BashArgs.parse(call.args).command);
}
