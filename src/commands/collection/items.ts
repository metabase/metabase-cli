import {
  COLLECTION_ITEM_FILTER_MODELS,
  COLLECTION_PINNED_STATES,
  CollectionItem,
  CollectionItemCompact,
  CollectionItemFilterModel,
  CollectionPinnedState,
  collectionItemView,
} from "../../domain/collection";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../../output/types";
import { parseEnum, parseEnumCsv } from "../../runtime/csv";
import { collectPaginated } from "../../runtime/paginate";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { parseCollectionRef } from "./parse-ref";

export const CollectionItemListEnvelope = listEnvelopeSchema(CollectionItemCompact);

export default defineMetabaseCommand({
  meta: { name: "items", description: "List items inside a collection" },
  args: {
    ...outputFlags,
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
    limit: {
      type: "string",
      description: "Cap total items returned (default: drain all pages)",
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
    const max = args.limit === undefined ? undefined : parseId(args.limit, "--limit");
    const client = await getClient();

    const items = await collectPaginated(client, `/api/collection/${ref}/items`, CollectionItem, {
      query: {
        models,
        archived: args.archived ? true : undefined,
        pinned_state: pinnedState,
      },
      ...(max !== undefined && { max }),
    });

    const envelope: ListEnvelope<CollectionItem> = {
      data: items,
      returned: items.length,
      ...(max === undefined ? { total: items.length } : { limit: max }),
    };
    renderList(envelope, collectionItemView, ctx);
  },
});
