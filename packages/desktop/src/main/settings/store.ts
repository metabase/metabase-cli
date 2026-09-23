import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { formatZodIssue, isFileNotFoundError } from "@metabase/client/errors";
import { parseJsonResult } from "@metabase/client/json";

import { USER_ONLY_FILE_MODE, writeFileAtomically } from "../atomic-file";

import { INITIAL_LAYOUT, PANEL_BOUNDS } from "../../contracts/layout";
import {
  SETTINGS_VERSION,
  Settings,
  SettingsV1,
  SettingsV2,
  SettingsV3,
  SettingsV4,
  SettingsV5,
  StoredSettings,
  type AgentDefaults,
  type ProviderPreference,
} from "../../contracts/settings";
import { FALLBACK_MODELS } from "../providers/catalogs";

export const SETTINGS_FILE_NAME = "settings.json";

const SETTINGS_INDENT = 2;
const GENERATION_UNVERSIONED = 0;
const GENERATION_WITHOUT_WORKTREE_ROOT = 1;
const GENERATION_WITHOUT_EDITOR = 2;
const GENERATION_WITHOUT_LAYOUT = 3;
const GENERATION_WITHOUT_AGENTS = 4;
const GENERATION_WITHOUT_TREE = 5;

export class SettingsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsFileError";
  }
}

const DEFAULT_PROVIDER_PREFERENCE: ProviderPreference = { enabled: true, binaryPath: null };

// Each agent starts on the model it names as its own default, and every session asks first.
function initialAgents(): AgentDefaults {
  return {
    models: {
      claude: FALLBACK_MODELS.claude.defaultModel,
      codex: FALLBACK_MODELS.codex.defaultModel,
    },
    permissionMode: "ask",
  };
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    metabase: null,
    repository: null,
    worktreeRoot: null,
    editor: null,
    providers: {
      claude: { ...DEFAULT_PROVIDER_PREFERENCE },
      codex: { ...DEFAULT_PROVIDER_PREFERENCE },
    },
    theme: "system",
    layout: { ...INITIAL_LAYOUT },
    agents: initialAgents(),
  };
}

const SettingsGeneration = z.object({ version: z.number().int() }).loose();

type SettingsMigration = (raw: unknown, source: string) => Settings;

function parseOrFail<Value>(schema: z.ZodType<Value>, raw: unknown, source: string): Value {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map(formatZodIssue).join("; ");
  throw new SettingsFileError(`${source}: ${issues}`);
}

function migrateUnversioned(raw: unknown, source: string): Settings {
  const legacy = parseOrFail(StoredSettings, raw, source);
  const theme = legacy.theme;
  if (theme === undefined) {
    return defaultSettings();
  }
  return { ...defaultSettings(), theme };
}

function migrateWithoutWorktreeRoot(raw: unknown, source: string): Settings {
  const previous = parseOrFail(SettingsV1, raw, source);
  return {
    ...previous,
    version: SETTINGS_VERSION,
    worktreeRoot: null,
    editor: null,
    layout: { ...INITIAL_LAYOUT },
    agents: initialAgents(),
  };
}

function migrateWithoutEditor(raw: unknown, source: string): Settings {
  const previous = parseOrFail(SettingsV2, raw, source);
  return {
    ...previous,
    version: SETTINGS_VERSION,
    editor: null,
    layout: { ...INITIAL_LAYOUT },
    agents: initialAgents(),
  };
}

function migrateWithoutLayout(raw: unknown, source: string): Settings {
  const previous = parseOrFail(SettingsV3, raw, source);
  return {
    ...previous,
    version: SETTINGS_VERSION,
    layout: { ...INITIAL_LAYOUT },
    agents: initialAgents(),
  };
}

function migrateWithoutAgents(raw: unknown, source: string): Settings {
  const previous = parseOrFail(SettingsV4, raw, source);
  return {
    ...previous,
    version: SETTINGS_VERSION,
    layout: { ...previous.layout, tree: PANEL_BOUNDS.tree.initial },
    agents: initialAgents(),
  };
}

function migrateWithoutTree(raw: unknown, source: string): Settings {
  const previous = parseOrFail(SettingsV5, raw, source);
  return {
    ...previous,
    version: SETTINGS_VERSION,
    layout: { ...previous.layout, tree: PANEL_BOUNDS.tree.initial },
  };
}

const MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {
  [GENERATION_UNVERSIONED]: migrateUnversioned,
  [GENERATION_WITHOUT_WORKTREE_ROOT]: migrateWithoutWorktreeRoot,
  [GENERATION_WITHOUT_EDITOR]: migrateWithoutEditor,
  [GENERATION_WITHOUT_LAYOUT]: migrateWithoutLayout,
  [GENERATION_WITHOUT_AGENTS]: migrateWithoutAgents,
  [GENERATION_WITHOUT_TREE]: migrateWithoutTree,
};

function readGeneration(raw: unknown): number {
  const parsed = SettingsGeneration.safeParse(raw);
  return parsed.success ? parsed.data.version : GENERATION_UNVERSIONED;
}

function decodeSettings(raw: unknown, source: string): Settings {
  const generation = readGeneration(raw);
  if (generation === SETTINGS_VERSION) {
    return parseOrFail(Settings, raw, source);
  }
  const migration = MIGRATIONS[generation];
  if (migration === undefined) {
    throw new SettingsFileError(
      `${source}: settings version ${generation} was written by a newer RDE (this one reads ${SETTINGS_VERSION})`,
    );
  }
  return migration(raw, source);
}

async function readSettingsFile(path: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return defaultSettings();
    }
    throw error;
  }
  const parsed = parseJsonResult(text, z.unknown(), { source: path });
  if (!parsed.ok) {
    throw new SettingsFileError(parsed.error.message);
  }
  return decodeSettings(parsed.value, path);
}

type SettingsChange = (current: Settings) => Settings;

export class SettingsStore {
  private settings: Settings;
  // Every change reads the settings the previous one wrote, so a burst of changes from different
  // callers lands whole and in the order it was asked for.
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly directory: string,
    settings: Settings,
  ) {
    this.settings = settings;
  }

  static async open(directory: string): Promise<SettingsStore> {
    await mkdir(directory, { recursive: true });
    const settings = await readSettingsFile(join(directory, SETTINGS_FILE_NAME));
    return new SettingsStore(directory, settings);
  }

  get path(): string {
    return join(this.directory, SETTINGS_FILE_NAME);
  }

  current(): Settings {
    return this.settings;
  }

  update(change: SettingsChange): Promise<Settings> {
    const apply = (): Promise<Settings> => this.write(change(this.settings));
    const written = this.pending.then(apply, apply);
    this.pending = written;
    return written;
  }

  private async write(next: Settings): Promise<Settings> {
    const contents = `${JSON.stringify(next, null, SETTINGS_INDENT)}\n`;
    await writeFileAtomically(this.path, contents, USER_ONLY_FILE_MODE);
    this.settings = next;
    return next;
  }
}
