import { z } from "zod";

import { parseJsonResult } from "@metabase/client/json";

import type { SessionEnvironment } from "../../contracts/connection";
import { NOT_CONNECTED_MESSAGE } from "../auth/session-environment";
import { outputTail, type CommandResult, type RunCommand } from "../process/spawn";

import { RUN_AS_NODE, RUN_AS_NODE_ENV_VAR, SKILLS_DIR_ENV_VAR, type CliLocation } from "./paths";

// An import waits for Metabase to finish the task, which on a large instance takes minutes.
const CLI_TIMEOUT_MS = 15 * 60_000;
const CLI_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const JSON_FLAG = "--json";
const ENVELOPE_START = "{";
const SUCCESS_EXIT = 0;
const FAILURE_EXIT = 1;

// The exits whose stdout is the command's answer. A command that reports its own failure inside
// that answer (`validate`'s `ok`, a waited run's final status) prints it and then exits with the
// CLI's failure code.
const ANSWERED_EXITS: ReadonlySet<number> = new Set([SUCCESS_EXIT]);
const REPORTED_EXITS: ReadonlySet<number> = new Set([SUCCESS_EXIT, FAILURE_EXIT]);

const CliErrorEnvelope = z
  .object({
    ok: z.literal(false),
    error: z.object({ category: z.string().min(1), message: z.string().min(1) }).loose(),
  })
  .loose();

// The CLI's own words for these name the transport ("fetch failed"); the app knows which instance
// did not answer and says that instead.
const UNREACHABLE_CATEGORIES: ReadonlySet<string> = new Set(["network", "timeout"]);

interface CliAnswered<Value> {
  readonly kind: "answered";
  readonly value: Value;
}

interface CliFailed {
  readonly kind: "failed";
  readonly message: string;
}

export type CliOutcome<Value> = CliAnswered<Value> | CliFailed;

interface Printed {
  readonly invocation: string;
  readonly stdout: string;
}

interface CliDeps {
  readonly location: CliLocation;
  readonly run: RunCommand;
  readonly env: NodeJS.ProcessEnv;
  readonly credentials: () => SessionEnvironment | null;
  readonly release: (brokerSessionId: string) => void;
  readonly signal: AbortSignal;
}

// Off a terminal the CLI reports a failure as one JSON envelope on stderr, after any warnings.
function envelopeMessage(stderr: string, url: string): string | null {
  const lines = stderr.split("\n");
  const start = lines.findIndex((line) => line.startsWith(ENVELOPE_START));
  if (start === -1) {
    return null;
  }
  const parsed = parseJsonResult(lines.slice(start).join("\n"), CliErrorEnvelope);
  if (!parsed.ok) {
    return null;
  }
  const error = parsed.value.error;
  return UNREACHABLE_CATEGORIES.has(error.category)
    ? `Metabase at ${url} didn't answer. Check that it's running and reachable, then try again.`
    : error.message;
}

function failureOf(invocation: string, url: string, result: CommandResult): CliFailed {
  if (result.kind === "spawn-failed") {
    return { kind: "failed", message: `${invocation} could not be run: ${result.message}` };
  }
  if (result.kind === "timed-out") {
    return {
      kind: "failed",
      message: `${invocation} did not finish within ${result.timeoutMs} ms.`,
    };
  }
  const message = envelopeMessage(result.stderr, url) ?? outputTail(result);
  return {
    kind: "failed",
    message: message ?? `${invocation} exited ${result.code} and printed nothing.`,
  };
}

// The app runs the same `mb` a session does, under a broker session of its own that ends with the
// command.
export class MetabaseCli {
  constructor(private readonly deps: CliDeps) {}

  // The same CLI with more environment on every command it runs.
  withEnvironment(env: NodeJS.ProcessEnv): MetabaseCli {
    return new MetabaseCli({ ...this.deps, env: { ...this.deps.env, ...env } });
  }

  async run<Value>(
    cwd: string,
    args: readonly string[],
    schema: z.ZodType<Value>,
  ): Promise<CliOutcome<Value>> {
    return parsedAnswer(await this.execute(cwd, args, ANSWERED_EXITS), schema);
  }

  // For a command whose answer says whether it failed; an exit with nothing on stdout is still the
  // CLI's refusal.
  async report<Value>(
    cwd: string,
    args: readonly string[],
    schema: z.ZodType<Value>,
  ): Promise<CliOutcome<Value>> {
    return parsedAnswer(await this.execute(cwd, args, REPORTED_EXITS), schema);
  }

  // For a command whose success is its exit alone.
  async complete(cwd: string, args: readonly string[]): Promise<CliOutcome<null>> {
    const printed = await this.execute(cwd, args, ANSWERED_EXITS);
    return printed.kind === "failed" ? printed : { kind: "answered", value: null };
  }

  private async execute(
    cwd: string,
    args: readonly string[],
    answeredExits: ReadonlySet<number>,
  ): Promise<CliOutcome<Printed>> {
    const credentials = this.deps.credentials();
    if (credentials === null) {
      return { kind: "failed", message: NOT_CONNECTED_MESSAGE };
    }
    const invocation = `mb ${args.join(" ")}`;
    try {
      const result = await this.deps.run({
        command: this.deps.location.node,
        args: [this.deps.location.entry, ...args, JSON_FLAG],
        env: {
          ...this.deps.env,
          [RUN_AS_NODE_ENV_VAR]: RUN_AS_NODE,
          [SKILLS_DIR_ENV_VAR]: this.deps.location.skills,
          MB_URL: credentials.MB_URL,
          MB_AUTH_BROKER: credentials.MB_AUTH_BROKER,
          MB_AUTH_BROKER_TOKEN: credentials.MB_AUTH_BROKER_TOKEN,
        },
        cwd,
        timeoutMs: CLI_TIMEOUT_MS,
        maxOutputBytes: CLI_OUTPUT_LIMIT_BYTES,
        signal: this.deps.signal,
      });
      if (result.kind !== "exited") {
        return failureOf(invocation, credentials.MB_URL, result);
      }
      const answered =
        answeredExits.has(result.code) &&
        (result.code === SUCCESS_EXIT || result.stdout.trim().length > 0);
      if (!answered) {
        return failureOf(invocation, credentials.MB_URL, result);
      }
      if (result.truncated) {
        return {
          kind: "failed",
          message: `${invocation} printed more than ${CLI_OUTPUT_LIMIT_BYTES} bytes, so its answer is incomplete.`,
        };
      }
      return { kind: "answered", value: { invocation, stdout: result.stdout } };
    } finally {
      this.deps.release(credentials.sessionId);
    }
  }
}

function parsedAnswer<Value>(
  printed: CliOutcome<Printed>,
  schema: z.ZodType<Value>,
): CliOutcome<Value> {
  if (printed.kind === "failed") {
    return printed;
  }
  const { invocation, stdout } = printed.value;
  const parsed = parseJsonResult(stdout, schema, { source: invocation });
  if (!parsed.ok) {
    return { kind: "failed", message: parsed.error.message };
  }
  return { kind: "answered", value: parsed.value };
}
