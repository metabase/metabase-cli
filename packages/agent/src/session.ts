import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type AgentSession,
  type AgentSessionRuntime,
  AuthStorage,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRegistry,
  resolveCliModel,
  type InlineExtension,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { type InstanceContext, UNKNOWN_INSTANCE } from "./metabase/probe";
import { type AgentModel, DEFAULT_AGENT_MODEL } from "./models";
import { buildSystemPrompt } from "./prompt";
import { metabaseSkillPaths } from "./skills";
import { metabaseTools } from "./tools/index";
import { fileToolRenderers } from "./tui/file-tools";

export type InstanceProvider = () => InstanceContext;
export type InstanceSource = InstanceContext | InstanceProvider;

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export interface MetabaseAgentSessionOptions {
  cwd: string;
  agentDir?: string;
  model?: AgentModel;
  thinkingLevel?: ThinkingLevel;
  // Where pi keeps provider credentials. Defaults to in-memory: a library caller supplies its key in
  // the environment and must not read, or write, an operator's keychain.
  authStorage?: AuthStorage;
  client?: Client;
  // A value, or a source read on every session build — `/mb-login` establishes the instance after
  // the first session exists, and pi rebuilds the session through this same factory.
  instance?: InstanceSource;
  customTools?: ToolDefinition[];
  extensions?: InlineExtension[];
  systemPrompt?: string;
}

export async function createMetabaseAgentSession(
  options: MetabaseAgentSessionOptions,
): Promise<AgentSession> {
  const createRuntime = await metabaseRuntimeFactory(options);
  const { session } = await createRuntime(initialTarget(options));
  return session;
}

// pi's TUI drives an `AgentSessionRuntime`, not a session: it re-creates the session (and the
// cwd-bound services under it) on `/new`, `/resume`, and every cwd switch, through the same factory.
export async function createMetabaseAgentRuntime(
  options: MetabaseAgentSessionOptions,
): Promise<AgentSessionRuntime> {
  const createRuntime = await metabaseRuntimeFactory(options);
  return createAgentSessionRuntime(createRuntime, initialTarget(options));
}

interface RuntimeTarget {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
}

function initialTarget(options: MetabaseAgentSessionOptions): RuntimeTarget {
  return {
    cwd: options.cwd,
    agentDir: options.agentDir ?? options.cwd,
    sessionManager: SessionManager.inMemory(options.cwd),
  };
}

// pi's interactive mode reports installs to pi.dev and, on an opt-in, sends analytics. mb-agent pins
// pi exact and is not pi, so neither report describes anything its authors could act on.
//
// A reasoning block rendered in full buries the answer it precedes; collapsed, Ctrl-T still opens
// it, and `src/tui/thinking.ts` names what the model is reasoning about while it streams.
function metabaseSettings(): SettingsManager {
  // pi's startup listing enumerates the skills and extensions the harness loaded. Both are its own
  // plumbing — the operator chose neither, and an inline extension has no name to show but its index.
  return SettingsManager.inMemory({
    enableInstallTelemetry: false,
    enableAnalytics: false,
    hideThinkingBlock: true,
    quietStartup: true,
  });
}

// Everything a Metabase session needs beyond pi's own services — the Metabase client, the probed
// instance, the model and its key — is fixed for the process and closed over here. Only the
// cwd-bound pieces are rebuilt per session: the services, and the curated tools bound to the cwd.
async function metabaseRuntimeFactory(
  options: MetabaseAgentSessionOptions,
): Promise<CreateAgentSessionRuntimeFactory> {
  const model = options.model ?? DEFAULT_AGENT_MODEL;

  const authStorage = options.authStorage ?? AuthStorage.inMemory();
  if (model.apiKey !== null) {
    authStorage.setRuntimeApiKey(model.provider, model.apiKey);
  }
  const modelRegistry =
    model.modelsJsonPath === null
      ? ModelRegistry.inMemory(authStorage)
      : ModelRegistry.create(authStorage, model.modelsJsonPath);

  const resolved = resolveCliModel({ cliModel: model.spec, modelRegistry });
  if (resolved.error !== undefined) {
    throw new Error(resolved.error);
  }
  const resolvedModel = resolved.model;
  if (!resolvedModel) {
    throw new Error(`Could not resolve model "${model.spec}".`);
  }
  const thinkingLevel = options.thinkingLevel ?? model.thinkingLevel ?? resolved.thinkingLevel;

  const settingsManager = metabaseSettings();
  // `noSkills` drops pi's own discovery (the operator's `~/.pi` skills, the cwd's project skills);
  // the Metabase skill directories are then the whole set the model sees, so the same prompt is
  // assembled on every machine.
  const skillPaths = metabaseSkillPaths();

  return async (target) => {
    const systemPrompt = options.systemPrompt ?? buildSystemPrompt(readInstance(options.instance));
    const services = await createAgentSessionServices({
      cwd: target.cwd,
      agentDir: target.agentDir,
      authStorage,
      settingsManager,
      modelRegistry,
      resourceLoaderOptions: {
        noSkills: true,
        additionalSkillPaths: skillPaths,
        extensionFactories: options.extensions ?? [],
        systemPromptOverride: () => systemPrompt,
      },
    });

    const customTools = resolveCustomTools(options, services.cwd, readInstance(options.instance));
    const toolNames = new Set([...BUILTIN_TOOLS, ...customTools.map((tool) => tool.name)]);
    const sessionOptions: CreateAgentSessionFromServicesOptions = {
      services,
      sessionManager: target.sessionManager,
      model: resolvedModel,
      tools: [...toolNames],
      customTools,
    };
    if (thinkingLevel !== undefined) {
      sessionOptions.thinkingLevel = thinkingLevel;
    }
    if (target.sessionStartEvent !== undefined) {
      sessionOptions.sessionStartEvent = target.sessionStartEvent;
    }

    const created = await createAgentSessionFromServices(sessionOptions);
    return { ...created, services, diagnostics: services.diagnostics };
  };
}

function readInstance(source: InstanceSource | undefined): InstanceContext {
  if (source === undefined) {
    return UNKNOWN_INSTANCE;
  }
  return typeof source === "function" ? source() : source;
}

// The file tools are pi's, and they execute pi's implementation; only their rendering is ours. A
// tool of the same name replaces the builtin in the registry, so the definition here is the builtin
// with a header the reader can scan alongside the Metabase calls it sits between.
function resolveCustomTools(
  options: MetabaseAgentSessionOptions,
  cwd: string,
  instance: InstanceContext,
): ToolDefinition[] {
  const rendered = fileToolRenderers(cwd);
  if (options.customTools !== undefined) {
    return [...options.customTools, ...rendered];
  }
  if (options.client !== undefined) {
    return [...metabaseTools({ client: options.client, cwd, instance }), ...rendered];
  }
  return rendered;
}
