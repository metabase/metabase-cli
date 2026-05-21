import {
  EID_MODELS,
  EidModel,
  EidTranslateInput,
  EidTranslateResult,
  eidTranslateView,
} from "../../domain/eid-translation";
import { ConfigError } from "../../core/errors";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { parseCsv } from "../../runtime/csv";
import { bodyInputFlags } from "../body-flags";
import { requireBothOrNeither } from "../flag-pair";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "translate",
    description: "Translate entity ids (EIDs) to numeric ids",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    model: {
      type: "string",
      description: `Entity model for shortcut form: ${EID_MODELS.join(" | ")}`,
    },
    eids: {
      type: "string",
      description: "Comma-separated EIDs (used with --model as a shortcut)",
    },
  },
  outputSchema: EidTranslateResult,
  examples: [
    "mb eid translate --model card --eids abc123XYZ,def456ABC",
    "mb eid translate --file translate.json",
    'mb eid translate --body \'{"entity_ids":{"card":["abc123XYZ"]}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const pair = requireBothOrNeither(
      { name: "--model", value: args.model },
      { name: "--eids", value: args.eids },
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
    renderItem(result, eidTranslateView, ctx);
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
    throw new ConfigError("--eids must contain at least one EID");
  }
  return parts;
}
