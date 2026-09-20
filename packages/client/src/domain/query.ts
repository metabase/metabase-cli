import { z } from "zod";

// `dataset_query: {}` is accepted by the server's `::query` schema for historic
// reasons but immediately trips the NOT NULL constraint on REPORT_CARD.DATABASE_ID
// during INSERT, surfacing as a raw H2 stack trace. `dataset_query: null` is
// rejected by the create endpoint with a generic 400. Both are unrecoverable —
// reject at the CLI boundary so the agent gets a readable error.
export const DatasetQuery = z
  .object({})
  .loose()
  .refine((value) => "lib/type" in value || "type" in value, {
    message:
      'dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
  })
  .describe("MBQL 5, legacy MBQL, or native query");
export type DatasetQuery = z.infer<typeof DatasetQuery>;

// The download formats `POST /api/dataset/{format}` and `POST /api/card/{id}/query/{format}`
// stream, and the last path segment of both.
export const ExportFormat = z.enum(["csv", "json", "xlsx"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const SortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirection>;
