import { z } from "zod";

import { CardType } from "./card";
import { Table, TableCompact, withoutPublicationFlags } from "./table";
import { NonBlankText } from "./text";

// A saved question standing in as a table of the Saved Questions virtual database, id `card__<id>`.
// A database listing carries it without its columns.
export const DatabaseVirtualTable = z
  .object({
    id: z.string(),
    db_id: z.number().int(),
    display_name: z.string(),
    schema: z.string(),
    description: z.string().nullable(),
    type: CardType,
    moderated_status: z.string().nullable(),
    entity_id: z.string().nullable(),
  })
  .loose();
export type DatabaseVirtualTable = z.infer<typeof DatabaseVirtualTable>;

export const DatabaseVirtualTableCompact = DatabaseVirtualTable.pick({
  id: true,
  db_id: true,
  display_name: true,
  schema: true,
  description: true,
  type: true,
}).strip();
export type DatabaseVirtualTableCompact = z.infer<typeof DatabaseVirtualTableCompact>;

// The server merges a database's settings key by key, so an update names only the ones it changes.
const DATA_ACTIONS_SETTING = "database-enable-actions";
const WORKSPACES_SETTING = "database-enable-workspaces";

export const DatabaseSettings = z
  .object({
    [DATA_ACTIONS_SETTING]: z.boolean().optional(),
    [WORKSPACES_SETTING]: z.boolean().optional(),
  })
  .loose();
export type DatabaseSettings = z.infer<typeof DatabaseSettings>;

// A real table's id is a number and a virtual table's a `card__N` string, which is what tells the
// two members apart; only the Saved Questions database lists virtual ones.
export const Database = z
  .object({
    id: z.number().int(),
    name: z.string(),
    engine: z.string().optional(),
    is_saved_questions: z.boolean().optional(),
    // The Saved Questions database stands in for no real one and carries neither flag.
    is_sample: z.boolean().optional(),
    is_audit: z.boolean().optional(),
    initial_sync_status: z.string().nullable().optional(),
    // Absent for a caller who cannot write the database, and on a server that records no sync error.
    initial_sync_error: z.string().nullable().optional(),
    // The driver's capabilities; absent when the server has no driver loaded for the engine.
    features: z.array(z.string()).optional(),
    settings: DatabaseSettings.nullable().optional(),
    // The connection settings, answered to admins only; secrets come back redacted.
    details: z.record(z.string(), z.unknown()).nullable().optional(),
    tables: z
      .array(z.union([Table.transform(withoutPublicationFlags), DatabaseVirtualTable]))
      .optional(),
  })
  .loose();
export type Database = z.infer<typeof Database>;

export const DatabaseCompact = Database.pick({
  id: true,
  name: true,
  engine: true,
  is_saved_questions: true,
})
  .strip()
  .extend({
    tables: z.array(z.union([TableCompact, DatabaseVirtualTableCompact])).optional(),
  });
export type DatabaseCompact = z.infer<typeof DatabaseCompact>;

// What `include` accepts differs between the list and the single-database endpoints: only the latter
// can hydrate a table's fields.
export const DatabaseListInclude = z.enum(["tables"]);
export type DatabaseListInclude = z.infer<typeof DatabaseListInclude>;

export const DatabaseGetInclude = z.enum(["tables", "tables.fields"]);
export type DatabaseGetInclude = z.infer<typeof DatabaseGetInclude>;

export const DatabaseWithSettings = Database.extend({ settings: DatabaseSettings.nullable() });
export type DatabaseWithSettings = z.infer<typeof DatabaseWithSettings>;

export const DatabaseWithSettingsCompact = DatabaseWithSettings.pick({
  id: true,
  name: true,
  engine: true,
})
  .strip()
  .extend({
    settings: DatabaseSettings.pick({ [DATA_ACTIONS_SETTING]: true })
      .strip()
      .nullable(),
  });
export type DatabaseWithSettingsCompact = z.infer<typeof DatabaseWithSettingsCompact>;

// A connection's `details` are the driver's own keys (host, project id, credentials…), so they pass
// through unchecked; the server tests the connection before it saves one.
const DatabaseDetails = z.record(z.string(), z.unknown());

// The server also takes `schedules`, `auto_run_queries`, `cache_ttl`, `is_full_sync`, `is_on_demand`,
// `is_stub`, `connection_source` and `provider_name` on create; each has a server default, so the body
// is the connection alone and any other key is refused.
export const DatabaseCreateInput = z
  .object({
    name: NonBlankText,
    engine: NonBlankText,
    details: DatabaseDetails,
  })
  .strict();
export type DatabaseCreateInput = z.infer<typeof DatabaseCreateInput>;

// Each key is optional and the server changes only the ones named. A secret in `details` sent back
// as the redacted value the server answered keeps the stored secret. The server also takes
// `engine`, `description`, `caveats`, `points_of_interest`, `schedules`, `write_data_details` and
// sync and cache options; the body holds the connection and the settings alone, and any other key
// is refused.
export const DatabaseUpdateInput = z
  .object({
    name: NonBlankText.optional(),
    details: DatabaseDetails.optional(),
    settings: z
      .object({ [DATA_ACTIONS_SETTING]: z.boolean() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, "name the fields to change");
export type DatabaseUpdateInput = z.infer<typeof DatabaseUpdateInput>;

export const DatabaseSyncResult = z.object({
  id: z.number().int(),
  status: z.literal("ok"),
  initial_sync_status: z.string().nullable().optional(),
});
export type DatabaseSyncResult = z.infer<typeof DatabaseSyncResult>;
