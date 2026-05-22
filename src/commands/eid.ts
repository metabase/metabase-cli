import {
  EID_MODELS,
  EidModel,
  EidTranslateInput,
  EidTranslateResult,
  eidTranslateView,
} from "../domain/eid-translation";
import { ConfigError } from "../core/errors";
import { renderSummary } from "../output/render";
import { readBody } from "../runtime/body";
import { parseCsv } from "../runtime/csv";
import { bodyInputFlags } from "./body-flags";
import { requireBothOrNeither } from "./flag-pair";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "eid",
    description: "Translate Metabase entity ids (string EIDs) to numeric ids",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    model: {
      type: "string",
      description: `Entity model for the positional EIDs: ${EID_MODELS.join(" | ")}`,
    },
    eids: {
      type: "positional",
      required: false,
      description: "Comma-separated EIDs to translate (used with --model)",
    },
  },
  outputSchema: EidTranslateResult,
  examples: [
    "mb eid --model card abc123XYZ,def456ABC",
    "mb eid --file translate.json",
    'mb eid --body \'{"entity_ids":{"card":["abc123XYZ"]}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const pair = requireBothOrNeither(
      { name: "--model", value: args.model },
      { name: "<eids>", value: args.eids },
    );
    const body = pair
      ? EidTranslateInput.parse({
          entity_ids: { [parseModel(pair.first)]: parseEids(pair.second) },
        })
      : await readBody({ flag: args.body, file: args.file }, EidTranslateInput);
    const client = await getClient();
    const result = await client.requestParsed(
      EidTranslateResult,
      "/api/eid-translation/translate",
      { method: "POST", body },
    );
    const lines = Object.entries(result.entity_ids).map(([eid, entry]) => {
      const resolved = entry.status === "ok" && entry.id !== undefined;
      const target = resolved ? String(entry.id) : "not found";
      return `${entry.type} ${eid} → ${target}`;
    });
    renderSummary(result, eidTranslateView, lines.join("\n"), ctx);
  },
});

function parseModel(raw: string): EidModel {
  const result = EidModel.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`invalid --model: "${raw}" (expected one of: ${EID_MODELS.join(", ")})`);
  }
  return result.data;
}

function parseEids(raw: string): string[] {
  const parts = parseCsv(raw);
  if (parts.length === 0) {
    throw new ConfigError("provide at least one EID");
  }
  return parts;
}
