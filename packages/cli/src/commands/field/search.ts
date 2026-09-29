import type { FieldSearchMatches } from "@metabase/client/domain/field";
import { ConfigError } from "@metabase/client/errors";
import type { Page } from "@metabase/client/paginate";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { FieldValueLabel, fieldValueLabelView, toValueLabel } from "../../output/views/field";
import { collectForOutput, type PageRequest } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseText } from "../parse-text";
import { defineMetabaseCommand } from "../runtime";

export const FieldSearchListEnvelope = listEnvelopeSchema(FieldValueLabel);

// The walk always sends a bound, but a search with neither a value nor a `--limit` would walk the
// whole column, which is what the server's own rule refuses; `--limit` stands in for it.
export function fieldSearchValue(
  value: string | undefined,
  limit: number | undefined,
): string | undefined {
  if (value === undefined) {
    if (limit === undefined) {
      throw new ConfigError("--limit is required when --value is absent");
    }
    return undefined;
  }
  return parseText(value, "--value");
}

// A walk opens with what the server answers a search sent no `limit`, or with the caller's window
// when that is smaller, so a large `--limit` is not asked of the warehouse in one query the byte
// budget could then only trim.
const FIRST_SEARCH_SPAN = 1000;
// Every request answers the rows from the first, so a span grown by a fixed step would cost a
// quadratic number of rows; doubling keeps the rows fetched within a small multiple of those shown.
const SEARCH_SPAN_GROWTH = 2;

type SearchRows = (limit: number) => Promise<FieldSearchMatches>;

// The endpoint bounds itself with `limit` alone, reports no count, and stops at its own default
// when sent none. So every request carries a bound that covers the window's offset, and only an
// answer that did not fill its bound proves the rows ran out: a full one is asked again with a
// larger bound and yields the rows past the last, until the bound covers the window, probe row
// included. A field with custom display values answers every mapped value whatever the bound, so
// its answer ends the walk unless it happens to fill the bound exactly, which costs one more
// request answering nothing new.
async function* searchPages(
  searchRows: SearchRows,
  request: PageRequest,
): AsyncIterable<Page<FieldValueLabel>> {
  const windowSpan = request.max ?? Number.POSITIVE_INFINITY;
  let span = Math.min(windowSpan, FIRST_SEARCH_SPAN);
  let seen = request.offset;
  let filledBound = true;
  while (filledBound) {
    const bound = request.offset + span;
    const rows = await searchRows(bound);
    yield { items: rows.slice(seen).map(toValueLabel), total: null };
    filledBound = rows.length === bound && span < windowSpan;
    seen = bound;
    span = Math.min(span * SEARCH_SPAN_GROWTH, windowSpan);
  }
}

export default defineMetabaseCommand({
  meta: {
    name: "search",
    description: "Search a field's values, answering them paired with the values of another field",
  },
  details:
    "Each row is a distinct pair of a value of `<id>` and the value of `<search-id>` on the same warehouse row, ordered by value. A FK on either side is followed to the key it points at, so searching an id column by a name column answers id/name pairs; after that both fields must be on one table, and a pair that is not answers no rows rather than an error, as does any failure of the warehouse query. `--value` keeps the rows whose `<search-id>` value contains it, case-insensitively; without it the first `--limit` rows are answered, so one of the two is required. `label` is null when `<id>` and `<search-id>` resolve to the same field once FKs are followed. A field with custom display values answers every mapped value instead, with its display value as `label`, matching `--value` against the display value and ignoring `<search-id>`. The endpoint takes no offset and reports no count, so `total` is null, every request asks for the rows from the first, at most 1000 at first and twice as many on each request after until the window is covered, and `has_more` is proven by one row fetched past it.",
  requires: ["field.search"],
  args: {
    ...outputFlags,
    ...listFlags,
    limit: {
      type: "string",
      description:
        "Max items to return; required without --value (with it, default: as many as fit the output cap)",
    },
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id whose values are answered", required: true },
    "search-id": {
      type: "positional",
      description: "Field id whose values are searched",
      required: true,
    },
    value: {
      type: "string",
      description: "Text the searched values must contain (case-insensitive)",
    },
  },
  outputSchema: FieldSearchListEnvelope,
  examples: [
    "mb field search 100 101 --value ada",
    "mb field search 100 101 --value ada --limit 5 --json",
    "mb field search 100 101 --limit 20 --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const searchId = parseId(args["search-id"], "search-id");
    const value = fieldSearchValue(args.value, ctx.range.limit);
    const client = await getClient();

    const searchRows: SearchRows = (limit) =>
      client.field.search(id, searchId, value === undefined ? { limit } : { value, limit });
    const envelope = await collectForOutput(
      (request) => searchPages(searchRows, request),
      fieldValueLabelView,
      ctx,
    );
    renderList(envelope, fieldValueLabelView, ctx);
  },
});
