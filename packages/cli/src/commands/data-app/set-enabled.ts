import { z } from "zod";

import { DataApp } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

const EnabledWord = z.enum(["true", "false"]);

export default defineMetabaseCommand({
  meta: { name: "set-enabled", description: "Enable or disable a data app" },
  details:
    "A new app is enabled, served to admins and the groups assigned to it; disable it to take it down. A disabled app opens only in Data Studio (**Data apps** > the app > **Overview**), and `/apps/<slug>` says not found, admins included.",
  skills: [{ skill: "data-app", purpose: "turn an app off" }],
  requires: ["dataApp.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...slugArg,
    enabled: {
      type: "positional",
      description: "true to enable the app, false to disable it",
      required: true,
    },
  },
  outputSchema: DataApp,
  examples: [
    "mb data-app set-enabled sales-overview false",
    "mb data-app set-enabled sales-overview true",
  ],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const enabled = parseEnumFlag(args.enabled, EnabledWord, "enabled") === "true";
    const client = await getClient();
    const app = await client.dataApp.update(slug, { enabled });
    renderSummary(app, dataAppView, `${enabled ? "Enabled" : "Disabled"} data app ${slug}.`, ctx);
  },
});
