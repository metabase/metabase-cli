import { Collection, CollectionUpdateInput } from "@metabase/client/domain/collection";
import { ConfigError, MetabaseError, ResponseShapeError } from "@metabase/client/errors";
import { chainRequestFailure } from "@metabase/client/http/errors";
import { collectionView } from "../../output/views/collection";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { readUpdateInput, updateFlags } from "./update-flags";

const TRASH_REF = "trash";
// The keys the move-then-trash path acts on; any other key in the patch was applied by the move.
const MOVE_KEYS: ReadonlySet<string> = new Set(["parent_id", "archived"]);

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Rename, describe, move, trash, or restore a collection by id (partial)",
  },
  details: [
    "Changes only what you send, as flags or as a JSON body with any of `name`, `description` (`null` clears it), `parent_id` (`null` for the top level), `authority_level` and `archived`. Use flags or a body, not both (exit 2). An archived collection stays archived unless you pass `--archived false`. Takes the integer ID only; `root`, `trash` and entity IDs are refused.",
    '[mb collection update](#mb-collection-update) with `--archived false` (or `"archived": false` in a body) restores an archived collection to its old location, or, with `--parent-id`, under that parent. `--parent-id` alone moves an archived collection and leaves it in the trash.',
    "`--archived true` with `--parent-id` moves the collection and then trashes it, in two requests, since the server ignores `parent_id` when it trashes. If the second request fails, the error says that the collection moved but isn't in the trash.",
    "A `--parent-id` that names the trash is refused, except with `--archived true`, where it only trashes the collection.",
  ].join("\n\n"),
  requires: ["collection.get", "collection.update", "collection.archive"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...updateFlags,
    id: { type: "positional", description: "Collection id", required: true },
  },
  inputSchema: CollectionUpdateInput,
  outputSchema: Collection,
  examples: [
    'mb collection update 4 --name "Marketing"',
    'mb collection update 4 --description "Campaign reporting" --parent-id 2',
    "mb collection update 4 --parent-id root",
    "mb collection update 4 --clear-description",
    "mb collection update 4 --archived false",
    'mb collection update 4 --body \'{"parent_id":null,"authority_level":"official"}\'',
    "mb collection update 4 --file patch.json --json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const input = await readUpdateInput(args, readBody);
    const client = await getClient();
    const trash =
      typeof input.parent_id === "number" ? await client.collection.get(TRASH_REF) : null;
    const patch = withoutTrashParent(input, trash);
    const render = (updated: Collection): void => {
      renderSummary(
        updated,
        collectionView,
        `Updated collection ${updated.id} "${updated.name}".`,
        ctx,
      );
    };
    // The server reads an absent `archived` as false, and when `archived` turns true it trashes the
    // collection without reading `parent_id`. So a patch that leaves `archived` out carries the
    // stored value, and one that trashes and moves a live collection to another parent is sent as
    // the move and then the trash.
    const trashesAndMoves = patch.archived === true && patch.parent_id !== undefined;
    if (patch.archived !== undefined && !trashesAndMoves) {
      render(await client.collection.update(id, patch));
      return;
    }
    const stored = await client.collection.get(id);
    const storedIsArchived = storedArchived(stored);
    const staysUnderParent = stored.parent_id === patch.parent_id;
    if (patch.archived === undefined || storedIsArchived || staysUnderParent) {
      render(
        await client.collection.update(id, {
          ...patch,
          archived: patch.archived ?? storedIsArchived,
        }),
      );
      return;
    }
    await client.collection.update(id, { ...patch, archived: false });
    const trashed = await client.collection.archive(id).catch((error: unknown) => {
      throw chainTrashFailure(error, id, patch);
    });
    render(trashed);
  },
});

// A move into the Trash is refused by the server as a permissions failure, since a collection
// enters the Trash only by being trashed. A patch naming the Trash as the parent is therefore sent
// as the trash alone when it trashes, and refused when it does not.
function withoutTrashParent(
  patch: CollectionUpdateInput,
  trash: Collection | null,
): CollectionUpdateInput {
  if (trash === null || patch.parent_id !== trash.id) {
    return patch;
  }
  if (patch.archived !== true) {
    throw new ConfigError(
      `collection ${trash.id} is the Trash, which a collection enters only by being trashed: pass --archived true (archived: true in a body) instead of naming it as the parent`,
    );
  }
  const trashOnly: CollectionUpdateInput = { ...patch };
  delete trashOnly.parent_id;
  return trashOnly;
}

function storedArchived(collection: Collection): boolean {
  if (collection.archived === undefined) {
    const source = `collection ${collection.id}`;
    throw new ResponseShapeError(
      `${source} came back without "archived", so whether it is in the trash is unknown`,
      { kind: "decoded", source, value: null },
    );
  }
  return collection.archived;
}

function chainTrashFailure(error: unknown, id: number, patch: CollectionUpdateInput): unknown {
  if (!(error instanceof MetabaseError)) {
    return error;
  }
  const alsoUpdated = Object.keys(patch).some((key) => !MOVE_KEYS.has(key));
  const done = alsoUpdated ? "updated and moved" : "moved";
  return chainRequestFailure(
    error,
    `collection ${id} was ${done}, but moving it to the trash failed: ${error.userMessage}`,
  );
}
