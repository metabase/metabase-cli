import type { Field } from "@metabase/client/domain/field";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import {
  type FieldWithValues,
  FieldWithValuesCompact,
  fieldView,
  fieldWithValuesView,
} from "../../output/views/field";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const FieldListEnvelope = listEnvelopeSchema(
  FieldWithValuesCompact.partial({ values: true }),
);

const DROPDOWN_VALUE_TYPES = new Set<Field["has_field_values"]>(["list", "auto-list"]);

const VALUES_FETCH_CONCURRENCY = 4;

export default defineMetabaseCommand({
  meta: {
    name: "fields",
    description: "List fields on a table (projection over query_metadata.fields)",
  },
  details:
    "`--values` adds `values` to each field in the window: the raw distinct values of a field Metabase keeps a dropdown list for (`has_field_values` of `list` or `auto-list`), `null` on any other field.",
  requires: ["table.queryMetadata", "field.values"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Table id", required: true },
    values: {
      type: "boolean",
      description: "Add each dropdown field's cached distinct values",
    },
  },
  outputSchema: FieldListEnvelope,
  examples: ["mb table fields 42", "mb table fields 42 --values --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const table = await client.table.queryMetadata(id);
    const envelope = windowList(table.fields, ctx.range);
    if (args.values !== true) {
      renderList(envelope, fieldView, ctx);
      return;
    }
    // A values row is `[value]`, or `[value, label]` on a remapped field; a filter compares
    // against the raw value.
    const withValues = async (field: Field): Promise<FieldWithValues> => {
      if (!DROPDOWN_VALUE_TYPES.has(field.has_field_values)) {
        return { ...field, values: null };
      }
      const cached = await client.field.values(field.id);
      return { ...field, values: cached.values.map((row) => row[0]) };
    };
    const data: FieldWithValues[] = [];
    for (let start = 0; start < envelope.data.length; start += VALUES_FETCH_CONCURRENCY) {
      const batch = envelope.data.slice(start, start + VALUES_FETCH_CONCURRENCY);
      data.push(...(await Promise.all(batch.map(withValues))));
    }
    renderList({ ...envelope, data }, fieldWithValuesView, ctx);
  },
});
