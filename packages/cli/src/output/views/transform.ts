import {
  type Transform,
  TransformCompact,
  type TransformRun,
  TransformRunCompact,
  TransformTarget,
} from "@metabase/client/domain/transform";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

function formatTarget(value: unknown): string {
  const parsed = TransformTarget.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  const { schema, name } = parsed.data;
  return schema ? `${schema}.${name}` : name;
}

export const transformRunView: ResourceView<TransformRun> = {
  compactPick: TransformRunCompact,
  tableColumns: [
    { key: "id", label: "Run ID" },
    { key: "transform_id", label: "Transform" },
    { key: "status", label: "Status" },
    { key: "run_method", label: "Method" },
    { key: "start_time", label: "Started" },
    { key: "end_time", label: "Ended" },
    { key: "message", label: "Message" },
  ],
};

export const transformView: ResourceView<Transform> = {
  compactPick: TransformCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "source_type", label: "Source" },
    { key: "target", label: "Target", format: (value) => formatTarget(value) },
    { key: "target_db_id", label: "Target DB" },
    { key: "description", label: "Description" },
  ],
};
