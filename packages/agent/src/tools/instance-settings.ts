import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { Setting, SettingCompact } from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import { buildListEnvelope } from "./envelope";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { type ResponseFormat, resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, listResult, type TextToolResult } from "./tool-result";

const SETTINGS_PATH = "/api/setting";
const NEAR_MATCH_LIMIT = 5;
const NEAR_MATCH_MIN_TOKEN = 3;

const SettingList = z.array(Setting);

const ACTIONS = ["list", "get", "set"] as const;
type Action = (typeof ACTIONS)[number];

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`list` every setting (optionally narrowed by `filter`) · `get` one by `key` · `set` one to `value`.",
  }),
  key: Type.Optional(
    Type.String({
      description:
        "The setting key, kebab-case as the API names it — `site-name`, `report-timezone`, `enable-embedding-sdk`, `remote-sync-branch`. Required for `get` and `set`. An unknown key comes back with the near matches named.",
    }),
  ),
  value: Type.Optional(
    Type.Unsafe<JsonValue>({
      description:
        'The new value, as JSON of the setting\'s own type — a string is `"main"`, a boolean is `true`, a number is `42`, and `null` clears the setting back to its default. Required for `set`.',
    }),
  ),
  filter: Type.Optional(
    Type.String({
      description:
        "`list` only: keep the settings whose key contains this substring. An instance has hundreds of keys, so a bare `list` is mostly noise — filter by the area you care about (`email`, `embedding`, `sync`).",
    }),
  ),
  offset: Type.Optional(Type.Integer({ description: "`list` only: skip this many settings." })),
  response_format: responseFormatParam,
});

export function instanceSettingsTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "instance_settings",
    label: "Instance settings",
    description:
      'Read and write instance-wide settings — the admin surface behind email, embedding, caching, localization, uploads and git-sync. Writing one takes effect immediately for every user on the instance, and some (authentication, embedding) can lock people out, so read the current value before overwriting it.\n\nA setting whose value comes from an environment variable cannot be written through the API; the attempt returns a teaching error naming the variable to change instead.\n\nExamples: `{action: "list", filter: "embedding"}` · `{action: "get", key: "site-name"}` · `{action: "set", key: "report-timezone", value: "Europe/Berlin"}`',
    parameters,
    execute: (_id, params) => runInstanceSettingsTool(deps, params),
  });
}

type InstanceSettingsParams = Static<typeof parameters>;

export function runInstanceSettingsTool(
  deps: MetabaseToolDeps,
  params: InstanceSettingsParams,
): Promise<TextToolResult> {
  return guardTool(() => run(deps, params, resolveResponseFormat(params.response_format)));
}

async function run(
  deps: MetabaseToolDeps,
  params: InstanceSettingsParams,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const settings = await deps.client.requestParsed(SettingList, SETTINGS_PATH);

  switch (params.action) {
    case "list": {
      return listSettings(settings, params, format);
    }
    case "get": {
      const found = requireSetting(settings, requireKey(params));
      return jsonResult(
        `setting ${found.key}`,
        format === "detailed" ? found : SettingCompact.parse(found),
      );
    }
    case "set": {
      return await setSetting(deps.client, settings, params);
    }
  }
}

function listSettings(
  settings: readonly Setting[],
  params: InstanceSettingsParams,
  format: ResponseFormat,
): TextToolResult {
  const filter = params.filter;
  const matched =
    filter === undefined
      ? settings
      : settings.filter((setting) => setting.key.includes(filter.toLowerCase()));
  const offset = params.offset ?? 0;
  const page = matched.slice(offset);
  const envelope = buildListEnvelope(
    page.map((setting) => (format === "detailed" ? setting : SettingCompact.parse(setting))),
    {
      steering: {
        noun: "settings",
        context: filter === undefined ? undefined : `matching "${filter}"`,
        narrowWith: ["filter"],
        pageWith: "offset",
      },
      total: matched.length,
    },
  );
  return listResult("settings", envelope, format);
}

async function setSetting(
  client: Client,
  settings: readonly Setting[],
  params: InstanceSettingsParams,
): Promise<TextToolResult> {
  const key = requireKey(params);
  if (params.value === undefined) {
    throw new TeachingError(
      `\`set\` needs \`value\` — the new value as JSON. To clear "${key}" back to its default, pass \`value: null\`.`,
    );
  }
  const target = requireSetting(settings, key);
  if (target.is_env_setting) {
    throw new TeachingError(
      `"${key}" is set from the environment variable \`${target.env_name}\`, and the API cannot override it. Change the variable on the server and restart Metabase; nothing you send here will take.`,
    );
  }

  const value = jsonValueSchema.parse(params.value);
  await client.requestRaw(`${SETTINGS_PATH}/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { value },
    expectContentType: "binary",
  });
  const label = value === null ? `cleared setting ${key}` : `set setting ${key}`;
  return jsonResult(label, { key, value });
}

function requireKey(params: InstanceSettingsParams): string {
  const key = params.key?.trim();
  if (key === undefined || key === "") {
    throw new TeachingError(`\`${params.action}\` needs \`key\` — the setting's kebab-case name.`);
  }
  return key;
}

function requireSetting(settings: readonly Setting[], key: string): Setting {
  const found = settings.find((setting) => setting.key === key);
  if (found !== undefined) {
    return found;
  }
  const near = nearMatches(settings, key);
  const hint =
    near.length === 0
      ? 'Run `{action: "list", filter: "<area>"}` to see the keys this instance has.'
      : `Did you mean ${near.map((candidate) => `\`${candidate}\``).join(", ")}?`;
  throw new TeachingError(`This instance has no setting "${key}". ${hint}`);
}

function nearMatches(settings: readonly Setting[], key: string): string[] {
  const tokens = key.split("-").filter((token) => token.length >= NEAR_MATCH_MIN_TOKEN);
  if (tokens.length === 0) {
    return [];
  }
  return settings
    .filter((setting) => tokens.some((token) => setting.key.includes(token)))
    .slice(0, NEAR_MATCH_LIMIT)
    .map((setting) => setting.key);
}
