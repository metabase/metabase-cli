import { z } from "zod";
import { DependencyEntityType } from "@metabase/client/domain/dependency";

import type { Dependent } from "../../core/lineage";
import { LineageType } from "../../core/lineage";
import type { ResourceView } from "../view";

const EntityRef = z.object({ id: z.number().int().positive(), type: DependencyEntityType });

export const DependentCompact = z.object({
  id: z.number().int().positive(),
  type: z.enum(LineageType),
  name: z.string().nullable(),
  distance: z.number().int().positive(),
  path: z.array(EntityRef),
});

export const dependentView: ResourceView<Dependent> = {
  compactPick: DependentCompact,
  tableColumns: [
    { key: "type", label: "Type" },
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "distance", label: "Distance" },
    {
      key: "path",
      label: "Path",
      format: (value) =>
        Array.isArray(value)
          ? value
              .filter((item): item is { type: string; id: number } =>
                Boolean(
                  typeof item === "object" &&
                  item !== null &&
                  "type" in item &&
                  "id" in item &&
                  typeof item.type === "string" &&
                  typeof item.id === "number",
                ),
              )
              .map((item) => `${item.type}:${item.id}`)
              .join(" -> ")
          : "",
    },
  ],
};
