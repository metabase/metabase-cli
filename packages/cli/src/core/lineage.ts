import type {
  DependencyCardType,
  DependencyEntityType,
  DependencyNode,
} from "@metabase/client/domain/dependency";

export const LineageType = [
  "question",
  "model",
  "metric",
  "table",
  "transform",
  "snippet",
  "dashboard",
  "document",
  "sandbox",
  "segment",
  "measure",
] as const;
export type LineageType = (typeof LineageType)[number];

export interface EntityRef {
  id: number;
  type: DependencyEntityType;
}

export interface Dependent {
  id: number;
  type: LineageType;
  name: string | null;
  distance: number;
  path: EntityRef[];
}

export interface DependencyReader {
  (type: EntityRef["type"], id: number): Promise<DependencyNode[]>;
}

export async function walkDependents(read: DependencyReader, root: EntityRef) {
  const queue: Array<{ entity: EntityRef; path: EntityRef[] }> = [{ entity: root, path: [root] }];
  const seen = new Set([entityKey(root)]);
  const dependents: Dependent[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const direct = await read(current.entity.type, current.entity.id);
    for (const node of direct) {
      const entity: EntityRef = { type: node.type, id: node.id };
      const key = entityKey(entity);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const path = [...current.path, entity];
      dependents.push(buildDependent(node, path));
      queue.push({ entity, path });
    }
  }
  return dependents;
}

export function entityKey(entity: EntityRef): string {
  return `${entity.type}:${entity.id}`;
}

export function lineageType(node: DependencyNode): LineageType {
  if (node.type !== "card") {
    return node.type;
  }
  const cardType = node.data["type"];
  return isCardType(cardType) ? cardType : "question";
}

export function buildDependent(node: DependencyNode, path: EntityRef[]): Dependent {
  const rawName =
    node.type === "table" ? (node.data["display_name"] ?? node.data["name"]) : node.data["name"];
  return {
    id: node.id,
    type: lineageType(node),
    name: typeof rawName === "string" ? rawName : null,
    distance: path.length - 1,
    path,
  };
}

function isCardType(value: unknown): value is DependencyCardType {
  return value === "question" || value === "model" || value === "metric";
}
