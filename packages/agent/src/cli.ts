#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  type AuthStorage,
  InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { type ConfigFlags, resolveProfileName } from "@metabase/cli/config";
import { ConfigError, errorMessage } from "@metabase/cli/errors";
import { CliBinaryError } from "./auth/cli-binary";
import { runAgentAuth } from "./auth/mb-auth";
import { createProviderCredentials } from "./auth/provider-credentials";
import { keyringSecretStore } from "./auth/secret-store";
import { useAgentProfileStore } from "./auth/store";
import { MetabaseAccess } from "./metabase/access";
import {
  createMetabaseConnection,
  type MetabaseConnection,
  tryMetabaseConnection,
} from "./metabase/connection";
import { type InstanceContext, probeInstance } from "./metabase/probe";
import { metabaseFooterExtension } from "./tui/footer";
import { metabaseHeaderExtension } from "./tui/header";
import { metabaseLoginExtension } from "./tui/login-command";
import { metabaseSkillCommandsExtension } from "./tui/skill-commands";
import { metabaseThinkingExtension } from "./tui/thinking";
import {
  type AgentModel,
  AGENT_MODEL_ENV,
  DEFAULT_MODEL,
  ModelConfigError,
  resolveAgentModel,
  type ResolveAgentModelOptions,
} from "./models";
import {
  createMetabaseAgentRuntime,
  createMetabaseAgentSession,
  type MetabaseAgentSessionOptions,
} from "./session";
import { SkillsError } from "./skills";

const EXIT_CONFIG = 2;
const EXIT_ERROR = 1;
const USAGE =
  'Usage: mb-agent <run "<prompt>" | chat | auth <login|list|status|logout>> [--profile name] [--url url] [--api-key key] [--model provider/id[:thinking]] [--models-json file] [--cwd dir]\n';
const NOT_A_TTY =
  'chat needs an interactive terminal. Pipe a prompt into `mb-agent run "<prompt>"` instead.\n';
const NO_KEYCHAIN =
  "warning: no usable OS keychain; a key stored with /login lasts for this session only.\n";
const NO_INSTANCE =
  "No Metabase credential yet — run `/mb-login <url>` in the TUI to sign in through the browser.\n";
// pi's TUI checks npm for a newer pi on every start. mb-agent pins pi exact, so the upgrade it
// would advertise is not one the operator can take.
const PI_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";

interface Runtime {
  model: AgentModel;
  authStorage: AuthStorage;
  access: MetabaseAccess;
  profile: string;
}

interface ParsedArgs {
  mode: string | undefined;
  profile: string | undefined;
  url: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  modelsJson: string | undefined;
  cwd: string | undefined;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let profile: string | undefined;
  let url: string | undefined;
  let apiKey: string | undefined;
  let model: string | undefined;
  let modelsJson: string | undefined;
  let cwd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      profile = argv[++i];
    } else if (arg === "--url") {
      url = argv[++i];
    } else if (arg === "--api-key") {
      apiKey = argv[++i];
    } else if (arg === "--model") {
      model = argv[++i];
    } else if (arg === "--models-json") {
      modelsJson = argv[++i];
    } else if (arg === "--cwd") {
      cwd = argv[++i];
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }
  return {
    mode: positionals.shift(),
    profile,
    url,
    apiKey,
    model,
    modelsJson,
    cwd,
    positionals,
  };
}

function configFlags(args: ParsedArgs): ConfigFlags {
  const flags: ConfigFlags = {};
  if (args.profile !== undefined) {
    flags.profile = args.profile;
  }
  if (args.url !== undefined) {
    flags.url = args.url;
  }
  if (args.apiKey !== undefined) {
    flags.apiKey = args.apiKey;
  }
  return flags;
}

function readModel(args: ParsedArgs, authStorage: AuthStorage): AgentModel {
  const options: ResolveAgentModelOptions = {
    env: process.env,
    hasStoredCredential: (provider) => authStorage.hasAuth(provider),
    requireCredential: args.mode !== "chat",
  };
  if (args.model !== undefined) {
    options.model = args.model;
  }
  if (args.modelsJson !== undefined) {
    options.modelsJson = args.modelsJson;
  }
  return resolveAgentModel(options);
}

// Nobody named a model and the default provider had no key, so the resolver picked the provider that
// did. Say so: an operator who never asked for this model should not have to read the footer to
// discover which one is answering.
function chosenForItsCredential(args: ParsedArgs, model: AgentModel): boolean {
  const named = args.model !== undefined || process.env[AGENT_MODEL_ENV] !== undefined;
  return !named && model.spec !== DEFAULT_MODEL;
}

function subscribe(session: AgentSession): void {
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start") {
      process.stderr.write(`\n[tool] ${event.toolName}\n`);
    }
  });
}

async function resolveCwd(cwd: string | undefined): Promise<string> {
  if (cwd !== undefined) {
    return cwd;
  }
  return mkdtemp(join(tmpdir(), "mb-agent-"));
}

async function sessionOptions(
  args: ParsedArgs,
  runtime: Runtime,
): Promise<MetabaseAgentSessionOptions> {
  return {
    cwd: await resolveCwd(args.cwd),
    model: runtime.model,
    authStorage: runtime.authStorage,
    client: runtime.access.client,
    // Read on every session build, not captured: `/mb-login` may establish the instance after the
    // first session exists, and the prompt's instance facts must then describe the real one.
    instance: () => runtime.access.instance(),
    extensions: [
      metabaseHeaderExtension({ access: runtime.access }),
      metabaseFooterExtension({ access: runtime.access }),
      metabaseThinkingExtension(),
      metabaseSkillCommandsExtension(),
      metabaseLoginExtension({ access: runtime.access, profile: runtime.profile }),
    ],
  };
}

async function runOnce(args: ParsedArgs, runtime: Runtime): Promise<number> {
  const prompt = args.positionals[0];
  if (prompt === undefined) {
    process.stderr.write(USAGE);
    return EXIT_CONFIG;
  }
  const session = await createMetabaseAgentSession(await sessionOptions(args, runtime));
  try {
    subscribe(session);
    await session.prompt(prompt);
    process.stdout.write("\n");
    const error = session.agent.state.errorMessage;
    if (error !== undefined) {
      process.stderr.write(`${error}\n`);
      return EXIT_ERROR;
    }
    return 0;
  } finally {
    session.dispose();
  }
}

async function chat(args: ParsedArgs, runtime: Runtime): Promise<number> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(NOT_A_TTY);
    return EXIT_CONFIG;
  }
  process.env[PI_SKIP_VERSION_CHECK] = "1";
  const host = await createMetabaseAgentRuntime(await sessionOptions(args, runtime));
  // The TUI owns the process from here: `/quit`, Ctrl-C and Ctrl-D all exit through pi's own
  // shutdown, which disposes the runtime and calls `process.exit`.
  await new InteractiveMode(host).run();
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // `auth` is the CLI's own auth commands, run against the agent's profile store — its flags are
  // `mb`'s, so they pass through untouched rather than through this shell's parser.
  if (argv[0] === "auth") {
    try {
      return await runAgentAuth(argv.slice(1));
    } catch (error) {
      if (error instanceof CliBinaryError) {
        process.stderr.write(`${error.message}\n`);
        return EXIT_CONFIG;
      }
      throw error;
    }
  }

  const args = parseArgs(argv);
  if (args.mode !== "run" && args.mode !== "chat") {
    process.stderr.write(USAGE);
    return EXIT_CONFIG;
  }
  useAgentProfileStore();

  const credentials = createProviderCredentials(keyringSecretStore());
  if (!credentials.persistent && args.mode === "chat") {
    process.stderr.write(NO_KEYCHAIN);
  }

  let model: AgentModel;
  try {
    model = readModel(args, credentials.authStorage);
  } catch (error) {
    if (error instanceof ModelConfigError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CONFIG;
    }
    throw error;
  }
  if (chosenForItsCredential(args, model)) {
    process.stderr.write(`Using ${model.spec} — the model of the provider you have a key for.\n`);
  }

  const flags = configFlags(args);
  // `chat` opens without a Metabase credential and `/mb-login` establishes one. A headless `run` has
  // nowhere to sign in, so an unauthenticated one is a configuration error.
  let connection: MetabaseConnection | null;
  try {
    connection =
      args.mode === "chat"
        ? await tryMetabaseConnection(flags)
        : await createMetabaseConnection(flags);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CONFIG;
    }
    throw error;
  }

  const access = new MetabaseAccess(null);
  if (connection === null) {
    process.stderr.write(NO_INSTANCE);
  } else {
    let instance: InstanceContext;
    try {
      instance = await probeInstance(connection.client, connection.url);
    } catch (error) {
      process.stderr.write(`Cannot reach ${connection.url}: ${errorMessage(error)}\n`);
      return EXIT_ERROR;
    }
    access.adopt(connection, instance);
  }

  const runtime: Runtime = {
    model,
    authStorage: credentials.authStorage,
    access,
    profile: resolveProfileName(args.profile),
  };
  try {
    if (args.mode === "run") {
      return await runOnce(args, runtime);
    }
    return await chat(args, runtime);
  } catch (error) {
    if (error instanceof SkillsError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CONFIG;
    }
    throw error;
  }
}

process.exitCode = await main();
