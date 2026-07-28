import {
  COLLECTION_ITEM_FILTER_MODELS,
  COLLECTION_PINNED_STATES,
  CollectionItemCompact,
  CollectionItemFilterModel,
  CollectionPinnedState,
} from "@metabase/client/domain/collection";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { collectionItemView } from "../../output/views/collection";
import { collectForOutput } from "../../output/window";
import { parseEnum, parseEnumCsv } from "../../runtime/csv";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseCollectionRef } from "./parse-ref";

export const CollectionItemListEnvelope = listEnvelopeSchema(CollectionItemCompact);

export default defineMetabaseCommand({
  meta: { name: "items", description: "List items inside a collection" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: {
      type: "positional",
      description: 'Collection id, 21-char entity id, or one of: "root", "trash"',
      required: true,
    },
    models: {
      type: "string",
      description: `Comma-separated model filter: ${COLLECTION_ITEM_FILTER_MODELS.join(",")}`,
      alias: "m",
    },
    archived: {
      type: "boolean",
      description: "Return archived items instead of unarchived",
      default: false,
    },
    "pinned-state": {
      type: "string",
      description: `Pinned filter: ${COLLECTION_PINNED_STATES.join("|")}`,
    },
  },
  outputSchema: CollectionItemListEnvelope,
  examples: [
    "mb collection items 4",
    "mb collection items root --json",
    "mb collection items 4 --models card,dashboard --json",
    "mb collection items 4 --pinned-state is_pinned --json",
  ],
  async run({ args, ctx, getClient }) {
    const ref = parseCollectionRef(args.id);
    const models = parseEnumCsv(args.models, CollectionItemFilterModel, "--models");
    const pinnedState = parseEnum(args["pinned-state"], CollectionPinnedState, "--pinned-state");
    const client = await getClient();

    const envelope = await collectForOutput(
      (request) =>
        client.collection.itemPages(
          ref,
          { models, archived: args.archived ? true : undefined, pinned_state: pinnedState },
          request,
        ),
      collectionItemView,
      ctx,
    );
    renderList(envelope, collectionItemView, ctx);
  },
});
