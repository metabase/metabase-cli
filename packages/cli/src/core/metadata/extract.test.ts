import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MetadataExport } from "@metabase/client/domain/metadata-export";
import { parseJson } from "@metabase/client/json";

import { extractTableMetadata } from "./extract";

// The `database-metadata` repository's example export and the tree its extractor writes from it.
const REFERENCE_DIR = resolve(fileURLToPath(import.meta.url), "..", "reference");
const REFERENCE_EXPORT = join(REFERENCE_DIR, "table_metadata.json");
const REFERENCE_TREE = join(REFERENCE_DIR, "databases");

function referenceExport(): MetadataExport {
  return parseJson(readFileSync(REFERENCE_EXPORT, "utf8"), MetadataExport, {
    source: REFERENCE_EXPORT,
  });
}

function referenceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(REFERENCE_TREE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const full = join(entry.parentPath, entry.name);
    files.set(relative(REFERENCE_TREE, full).split(sep).join("/"), readFileSync(full, "utf8"));
  }
  return files;
}

describe("extractTableMetadata", () => {
  it("writes the reference tree byte for byte from the reference export", () => {
    const tree = extractTableMetadata(referenceExport(), { databases: null });

    const produced = new Map(tree.files.map((file) => [file.path, file.content]));
    expect(produced).toEqual(referenceFiles());
    expect(tree.stats).toEqual({ databases: 1, tables: 8, fields: 71 });
  });

  it("keeps only the named databases and counts only what it kept", () => {
    const metadata = referenceExport();

    const kept = extractTableMetadata(metadata, { databases: ["Sample Database"] });
    const none = extractTableMetadata(metadata, { databases: ["Other"] });

    expect(kept.files.map((file) => file.path)).toEqual(
      extractTableMetadata(metadata, { databases: null }).files.map((file) => file.path),
    );
    expect(none).toEqual({ files: [], stats: { databases: 0, tables: 0, fields: 0 } });
  });

  it("places a schemaless table directly under tables/ and keys it with a null schema", () => {
    const tree = extractTableMetadata(
      {
        databases: [{ id: 1, name: "Flat DB", engine: "sqlite" }],
        tables: [{ id: 10, db_id: 1, name: "events", schema: null }],
        fields: [
          {
            id: 100,
            table_id: 10,
            name: "id",
            base_type: "type/Integer",
            database_type: "INTEGER",
          },
          {
            id: 101,
            table_id: 10,
            name: "user_id",
            base_type: "type/Integer",
            database_type: "INTEGER",
            fk_target_field_id: 100,
          },
        ],
      },
      { databases: null },
    );

    expect(tree.files).toEqual([
      { path: "Flat DB/Flat DB.yaml", content: "name: Flat DB\nengine: sqlite\n" },
      {
        path: "Flat DB/tables/events.yaml",
        content:
          "name: events\nschema: null\ndb_id: Flat DB\nfields:\n" +
          "  - name: id\n    base_type: type/Integer\n    database_type: INTEGER\n" +
          "  - name: user_id\n    base_type: type/Integer\n    database_type: INTEGER\n" +
          "    fk_target_field_id:\n      - Flat DB\n      - null\n      - events\n      - id\n",
      },
    ]);
  });

  it("leaves out a parent or target reference the export cannot resolve", () => {
    const tree = extractTableMetadata(
      {
        databases: [{ id: 1, name: "DB", engine: "postgres" }],
        tables: [{ id: 10, db_id: 1, name: "t", schema: "public" }],
        fields: [
          { id: 100, table_id: 10, name: "a", parent_id: 999 },
          { id: 101, table_id: 10, name: "b", fk_target_field_id: 999 },
        ],
      },
      { databases: null },
    );

    expect(tree.files[1]).toEqual({
      path: "DB/schemas/public/tables/t.yaml",
      content: "name: t\nschema: public\ndb_id: DB\nfields:\n  - name: a\n  - name: b\n",
    });
  });
});
