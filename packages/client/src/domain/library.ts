import { z } from "zod";

import type { Features } from "../version/features";
import { Collection, CollectionId, CollectionType } from "./collection";

// The endpoint hydrates its children as a projection: one generation adds `type`, none carries
// `is_remote_synced`.
const LibraryChildWireV59 = z.object({
  id: CollectionId,
  name: z.string(),
  description: z.string().nullable(),
});
const LibraryChildWireV62 = LibraryChildWireV59.extend({ type: CollectionType.nullable() });

// `type` tells the Data and Metrics collections apart and `is_remote_synced` says whether a child
// is in the git-sync scope; the collection listing fills whatever the projection left out, and
// null is a child the listing does not describe.
export const LibraryChild = LibraryChildWireV62.extend({
  is_remote_synced: z.boolean().nullable(),
});
export type LibraryChild = z.infer<typeof LibraryChild>;

export const Library = Collection.extend({
  effective_children: z.array(LibraryChild),
}).loose();
export type Library = z.infer<typeof Library>;

export const LibraryCompact = Library.pick({
  id: true,
  name: true,
  type: true,
  effective_children: true,
}).strip();
export type LibraryCompact = z.infer<typeof LibraryCompact>;

// The listing's virtual root row carries neither `type` nor `is_remote_synced`, so the projection
// keeps both optional rather than letting an unrelated row decide whether the Library resolves —
// the same reason it does not pin `namespace` or `authority_level`.
export const LibraryCollectionInfo = Collection.pick({
  id: true,
  type: true,
  is_remote_synced: true,
}).strip();
export type LibraryCollectionInfo = z.infer<typeof LibraryCollectionInfo>;

export type LibraryListing = ReadonlyMap<number, LibraryCollectionInfo>;

const LibraryWireV59 = Collection.extend({
  effective_children: z.array(LibraryChildWireV59),
}).loose();
const LibraryWireV62 = Collection.extend({
  effective_children: z.array(LibraryChildWireV62),
}).loose();

// An instance with no Library answers the root with `{ data: null }` rather than a 404.
const AbsentLibrary = z.object({ data: z.null() });

interface LibraryWireWithoutChildType {
  readonly childrenCarryType: false;
  readonly root: z.infer<typeof LibraryWireV59>;
}

interface LibraryWireWithChildType {
  readonly childrenCarryType: true;
  readonly root: z.infer<typeof LibraryWireV62>;
}

export type LibraryWire = LibraryWireWithoutChildType | LibraryWireWithChildType;

/**
 * The shape `GET /api/ee/library/` answers on a server with `features`: the Library as sent,
 * awaiting `toLibrary`, or `null` on an instance that has none.
 */
export function libraryWireSchema(features: Features): z.ZodType<LibraryWire | null> {
  const present = features.libraryChildrenCarryType
    ? LibraryWireV62.transform((root): LibraryWire => ({ childrenCarryType: true, root }))
    : LibraryWireV59.transform((root): LibraryWire => ({ childrenCarryType: false, root }));
  return presentOrAbsent(present);
}

// A union of the two answers reports only its root as invalid; parsing the present form on its
// own keeps the field that failed in the message.
function presentOrAbsent<T>(present: z.ZodType<T>): z.ZodType<T | null> {
  return z.unknown().transform((value, ctx): T | null => {
    if (AbsentLibrary.safeParse(value).success) {
      return null;
    }
    const parsed = present.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue });
    }
    return z.NEVER;
  });
}

/** `wire` read as `Library`, with what its children's projection omitted taken from `listing`. */
export function toLibrary(wire: LibraryWire, listing: LibraryListing): Library {
  if (wire.childrenCarryType) {
    const effective_children = wire.root.effective_children.map((child) => ({
      ...child,
      is_remote_synced: listedSyncFlag(child.id, listing),
    }));
    return { ...wire.root, effective_children };
  }
  const effective_children = wire.root.effective_children.map((child) => ({
    ...child,
    type: listedType(child.id, listing),
    is_remote_synced: listedSyncFlag(child.id, listing),
  }));
  return { ...wire.root, effective_children };
}

function listed(id: CollectionId, listing: LibraryListing): LibraryCollectionInfo | null {
  if (typeof id !== "number") {
    return null;
  }
  return listing.get(id) ?? null;
}

function listedType(id: CollectionId, listing: LibraryListing): CollectionType | null {
  return listed(id, listing)?.type ?? null;
}

function listedSyncFlag(id: CollectionId, listing: LibraryListing): boolean | null {
  return listed(id, listing)?.is_remote_synced ?? null;
}
