import { z } from "zod";

import {
  type BreakingSource,
  BreakingSourceCompact,
  DependencyEdge,
  type DependencyEntity,
  DependencyEntityCompact,
  DependencyEntityData,
  DependencyFindingError,
  type DependencyGraph,
  DependencyGraphCompact,
  type DependencyNode,
  DependencyNodeCompact,
} from "@metabase/client/domain/dependency";

import { formatScalar, MALFORMED_CELL } from "../table";
import type { ColumnDef, ResourceView } from "../view";

const DependentsCount = DependencyNodeCompact.shape.dependents_count;
const DependentsErrors = BreakingSourceCompact.shape.dependents_errors;
const GraphNodes = z.array(DependencyNodeCompact);
const GraphEdges = z.array(DependencyEdge);
// The graph renders as a key-value item, whose value column cannot carry a line break: a
// continuation line would start under the labels.
const GRAPH_ITEM_SEPARATOR = "; ";

function formatEntityName(value: unknown): string {
  const parsed = DependencyEntityData.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return formatScalar(parsed.data.display_name ?? parsed.data.name);
}

// The location Metabase itself sorts and matches `query` on, read by the entity's type. A
// transform's row carries no collection, so its cell stays blank even where the server-paged
// listings match and sort it by that collection's name.
function entityLocation({ type, data }: DependencyEntity): string | null {
  switch (type) {
    case "card": {
      return (data.dashboard ?? data.document ?? data.collection)?.name ?? null;
    }
    case "table": {
      return data.db?.name ?? null;
    }
    case "segment":
    case "measure": {
      return data.table?.display_name ?? null;
    }
    case "snippet":
    case "dashboard":
    case "document": {
      return data.collection?.name ?? null;
    }
    case "transform":
    case "sandbox": {
      return null;
    }
  }
}

function formatDependentsCount(value: unknown): string {
  const parsed = DependentsCount.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  if (parsed.data === null) {
    return "";
  }
  return Object.entries(parsed.data)
    .map(([usage, count]) => `${usage}: ${count}`)
    .join(", ");
}

function formatDependentsErrors(value: unknown): string {
  const parsed = DependentsErrors.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  if (parsed.data === null || parsed.data === undefined) {
    return "";
  }
  return parsed.data.map(formatFindingError).join("; ");
}

function formatFindingError(error: DependencyFindingError): string {
  return `${error.analyzed_entity_type} ${error.analyzed_entity_id}: ${error.error_type}`;
}

function formatGraphNodes(value: unknown): string {
  const parsed = GraphNodes.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data
    .map((node) => `${node.type} ${node.id} ${formatEntityName(node.data)}`.trimEnd())
    .join(GRAPH_ITEM_SEPARATOR);
}

function formatGraphEdges(value: unknown): string {
  const parsed = GraphEdges.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data
    .map(
      (edge) =>
        `${edge.from_entity_type} ${edge.from_entity_id} -> ${edge.to_entity_type} ${edge.to_entity_id}`,
    )
    .join(GRAPH_ITEM_SEPARATOR);
}

const entityColumns: ColumnDef<DependencyEntity>[] = [
  { key: "id", label: "ID" },
  { key: "type", label: "Type" },
  { key: "data", label: "Name", format: formatEntityName },
  { key: "data", label: "Location", value: entityLocation },
];

const dependentsCountColumn: ColumnDef<DependencyNode> = {
  key: "dependents_count",
  label: "Dependents",
  format: formatDependentsCount,
};

export const dependencyEntityView: ResourceView<DependencyEntity> = {
  compactPick: DependencyEntityCompact,
  tableColumns: entityColumns,
};

export const dependencyNodeView: ResourceView<DependencyNode> = {
  compactPick: DependencyNodeCompact,
  tableColumns: [...entityColumns, dependentsCountColumn],
};

export const breakingSourceView: ResourceView<BreakingSource> = {
  compactPick: BreakingSourceCompact,
  tableColumns: [
    ...entityColumns,
    dependentsCountColumn,
    { key: "dependents_errors", label: "Errors", format: formatDependentsErrors },
  ],
};

export const dependencyGraphView: ResourceView<DependencyGraph> = {
  compactPick: DependencyGraphCompact,
  tableColumns: [
    { key: "nodes", label: "Nodes", format: formatGraphNodes },
    { key: "edges", label: "Edges", format: formatGraphEdges },
  ],
};
