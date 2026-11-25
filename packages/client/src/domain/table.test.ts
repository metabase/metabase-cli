import { describe, expect, it } from "vitest";

import { Database } from "./database";
import { QueryMetadata } from "./dataset";
import { Table, withoutPublicationFlags } from "./table";

// A table as the newest server answers it.
const TABLE = {
  id: 11,
  name: "orders",
  display_name: "Orders",
  description: null,
  caveats: null,
  db_id: 1,
  schema: "public",
  entity_type: "entity/TransactionTable",
  data_layer: null,
  estimated_row_count: null,
  active: true,
};

// What a server before Metabase 66 adds to every table.
const PUBLICATION_FLAGS = { is_published: true, collection_id: 9 };

const DATA_COLLECTION = { id: 9, name: "Data", type: "library-data" };

describe("withoutPublicationFlags", () => {
  it("drops the publication flags and keeps the collection a server sends", () => {
    const answered = { ...TABLE, ...PUBLICATION_FLAGS, collection: DATA_COLLECTION };

    expect(Table.transform(withoutPublicationFlags).parse(answered)).toEqual({
      ...TABLE,
      collection: DATA_COLLECTION,
    });
  });

  it("drops them from the tables a database lists, and leaves a virtual table as sent", () => {
    const virtual = {
      id: "card__4",
      db_id: -1337,
      display_name: "Revenue",
      schema: "Everything else",
      description: null,
      type: "question",
      moderated_status: null,
      entity_id: null,
    };

    expect(
      Database.parse({
        id: 1,
        name: "Warehouse",
        tables: [{ ...TABLE, ...PUBLICATION_FLAGS }, virtual],
      }),
    ).toEqual({ id: 1, name: "Warehouse", tables: [TABLE, virtual] });
  });

  it("drops them from the tables a query's metadata lists", () => {
    const metadata = { databases: [], fields: [], snippets: [] };

    expect(
      QueryMetadata.parse({
        ...metadata,
        tables: [{ ...TABLE, ...PUBLICATION_FLAGS, fields: [] }],
      }),
    ).toEqual({ ...metadata, tables: [{ ...TABLE, fields: [] }] });
  });
});
