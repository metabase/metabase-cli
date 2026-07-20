import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";
import type { EntityKind, EntityRef } from "../tools/entity";

/**
 * Where an entity lives in the Metabase UI. Ids alone are enough: every slugged route parses its
 * path segment with `parseInt`, so `/question/42` reaches the same page as `/question/42-revenue`.
 */
const PATH: Record<EntityKind, (id: string) => string> = {
  question: (id) => `/question/${id}`,
  model: (id) => `/model/${id}`,
  metric: (id) => `/metric/${id}`,
  dashboard: (id) => `/dashboard/${id}`,
  collection: (id) => `/collection/${id}`,
  document: (id) => `/document/${id}`,
  database: (id) => `/browse/databases/${id}`,
  table: (id) => `/table/${id}`,
  transform: (id) => `/data-studio/transforms/${id}`,
  transform_job: (id) => `/data-studio/transforms/jobs/${id}`,
  segment: (id) => `/reference/segments/${id}`,
};

// A table reached through its database is an ad-hoc question over it, which every reader of the
// table can open — `/table/:id` needs the table-metadata permission an admin has and a viewer
// may not.
function tablePath(ref: EntityRef): string {
  if (ref.databaseId === undefined) {
    return PATH.table(String(ref.id));
  }
  return `/question#?db=${String(ref.databaseId)}&table=${String(ref.id)}`;
}

function path(ref: EntityRef): string {
  return ref.kind === "table" ? tablePath(ref) : PATH[ref.kind](String(ref.id));
}

export interface Linker {
  href(ref: EntityRef): string | null;
  text(label: string, ref: EntityRef | null): string;
}

/** No instance to point at, or a terminal that would print the escape codes rather than obey them. */
export const PLAIN_LINKER: Linker = {
  href: () => null,
  text: (label) => label,
};

/**
 * Ids on screen are addresses: `collection 18` is a collection a reader can open, and a terminal
 * that speaks OSC 8 will let them. The base URL is the instance the session is authenticated to, so
 * a link always resolves against the Metabase the ids were read from.
 */
export function createLinker(baseUrl: string | null): Linker {
  if (baseUrl === null || !getCapabilities().hyperlinks) {
    return PLAIN_LINKER;
  }
  const href = (ref: EntityRef): string => `${baseUrl}${path(ref)}`;
  return {
    href,
    text: (label, ref) => (ref === null ? label : hyperlink(label, href(ref))),
  };
}
