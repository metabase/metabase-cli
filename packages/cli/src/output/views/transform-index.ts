import { z } from "zod";

import {
  type TransformIndex,
  TransformIndexCompact,
  type TransformIndexRequest,
  TransformIndexRequestCompact,
  TransformIndexStructured,
} from "@metabase/client/domain/transform-index";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

const ColumnNames = z.array(z.string());
const OptionalRequest = TransformIndexRequestCompact.optional();

function formatStructured(value: unknown): string {
  const parsed = TransformIndexStructured.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  const columns = parsed.data.columns;
  if (columns === undefined) {
    return parsed.data.kind;
  }
  return `${parsed.data.kind}(${columns.map((column) => column.name).join(", ")})`;
}

function formatColumnNames(value: unknown): string {
  const parsed = ColumnNames.safeParse(value);
  return parsed.success ? parsed.data.join(", ") : MALFORMED_CELL;
}

// An index the warehouse holds but Metabase does not manage carries no request, which is a fact
// about the index rather than a rendering failure.
function formatRequestSummary(value: unknown): string {
  const parsed = OptionalRequest.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data === undefined ? "" : `#${parsed.data.id} ${parsed.data.status}`;
}

export const transformIndexRequestView: ResourceView<TransformIndexRequest> = {
  compactPick: TransformIndexRequestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "transform_id", label: "Transform" },
    { key: "index_name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "structured", label: "Definition", format: formatStructured },
    { key: "error_message", label: "Error" },
  ],
};

export const transformIndexView: ResourceView<TransformIndex> = {
  compactPick: TransformIndexCompact,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "kind", label: "Kind" },
    { key: "key_columns", label: "Columns", format: formatColumnNames },
    { key: "is_unique", label: "Unique" },
    { key: "metabase_managed", label: "Managed" },
    { key: "present_in_warehouse", label: "In warehouse" },
    { key: "request", label: "Request", format: formatRequestSummary },
  ],
};
