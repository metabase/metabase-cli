import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import { resolveConfig, type ConfigFlags, type ResolvedConfig } from "../core/config";
import { createClient, type Client } from "../core/http/client";
import { createServerInfoCache, type ServerInfo } from "../core/version/probe";
import { reportError } from "../output/error";
import { setMetabaseAugment } from "../runtime/command-augment";

import { resolveCommonFlags, type CommonArgs, type CommonContext } from "./context";

export interface MetabaseCommandContext<A extends ArgsDef> {
  args: ParsedArgs<A>;
  ctx: CommonContext;
  getClient: () => Promise<Client>;
  getResolvedConfig: () => Promise<ResolvedConfig>;
  getServerInfo: () => Promise<ServerInfo>;
}

export interface MetabaseCommandDef<A extends ArgsDef> {
  meta: CommandMeta;
  args: A;
  examples?: readonly string[];
  outputSchema?: ZodType;
  run: (context: MetabaseCommandContext<A>) => Promise<void> | void;
}

export function defineMetabaseCommand<const A extends ArgsDef>(
  def: MetabaseCommandDef<A>,
): CommandDef<A> {
  const cmd = defineCommand<A>({
    meta: def.meta,
    args: def.args,
    async run({ args }) {
      try {
        const ctx = resolveCommonFlags(pickCommonArgs(args));
        let cachedConfig: ResolvedConfig | null = null;
        let cachedClient: Client | null = null;
        const getResolvedConfig = async (): Promise<ResolvedConfig> => {
          if (cachedConfig === null) {
            cachedConfig = await resolveConfig(buildConfigFlags(ctx));
          }
          return cachedConfig;
        };
        const getClient = async (): Promise<Client> => {
          if (cachedClient === null) {
            const resolved = await getResolvedConfig();
            cachedClient = createClient({ url: resolved.url, apiKey: resolved.apiKey });
          }
          return cachedClient;
        };
        const getServerInfo = createServerInfoCache(getClient);
        await def.run({ args, ctx, getClient, getResolvedConfig, getServerInfo });
      } catch (error) {
        reportError(error);
      }
    },
  });
  setMetabaseAugment(cmd, {
    examples: def.examples ?? [],
    outputSchema: def.outputSchema ?? null,
  });
  return cmd;
}

function pickCommonArgs<A extends ArgsDef>(args: ParsedArgs<A>): CommonArgs {
  const out: CommonArgs = {};
  if (typeof args["format"] === "string") {
    out.format = args["format"];
  }
  if (typeof args["json"] === "boolean") {
    out.json = args["json"];
  }
  if (typeof args["full"] === "boolean") {
    out.full = args["full"];
  }
  if (typeof args["fields"] === "string") {
    out.fields = args["fields"];
  }
  if (typeof args["maxBytes"] === "string") {
    out.maxBytes = args["maxBytes"];
  }
  if (typeof args["profile"] === "string") {
    out.profile = args["profile"];
  }
  if (typeof args["url"] === "string") {
    out.url = args["url"];
  }
  if (typeof args["apiKey"] === "string") {
    out.apiKey = args["apiKey"];
  }
  return out;
}

function buildConfigFlags(ctx: CommonContext): ConfigFlags {
  const flags: ConfigFlags = {};
  if (ctx.profile !== undefined) {
    flags.profile = ctx.profile;
  }
  if (ctx.url !== undefined) {
    flags.url = ctx.url;
  }
  if (ctx.apiKey !== undefined) {
    flags.apiKey = ctx.apiKey;
  }
  return flags;
}
