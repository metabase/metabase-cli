import { CardType } from "@metabase/client/domain/card";
import {
  DependencyItemsSortColumn,
  DependencyType,
  DependentsSortColumn,
} from "@metabase/client/domain/dependency";
import { SortDirection } from "@metabase/client/domain/query";
import type {
  DependencyBrokenParams,
  DependencyItemListParams,
} from "@metabase/client/resources/dependency";

import { LIST_SEPARATOR, parseEnum, parseEnumCsv } from "../../runtime/csv";
import type { FlagValues } from "../flag-values";
import { listFlag } from "../flags";
import { parseOptionalText } from "../parse-text";

const sharedFilterFlags = {
  "include-personal-collections": {
    type: "boolean",
    description: "Also list content in personal collections",
  },
  "sort-direction": {
    type: "string",
    description: `Sort direction: ${SortDirection.options.join("|")} (default: asc)`,
  },
} as const;

export const dependentFilterFlags = {
  "dependent-types": listFlag({
    type: "string",
    description: `Comma-separated entity kinds to keep: ${DependencyType.options.join(LIST_SEPARATOR)}`,
  }),
  "dependent-card-types": listFlag({
    type: "string",
    description: `Comma-separated card kinds to keep (narrows card dependents only): ${CardType.options.join(LIST_SEPARATOR)}`,
  }),
  "sort-column": {
    type: "string",
    description: `Sort by: ${DependentsSortColumn.options.join("|")} (default: name)`,
  },
  ...sharedFilterFlags,
} as const;

export function readDependentFilters(
  args: FlagValues<typeof dependentFilterFlags>,
): DependencyBrokenParams {
  return {
    "dependent-types": parseEnumCsv(args["dependent-types"], DependencyType, "--dependent-types"),
    "dependent-card-types": parseEnumCsv(
      args["dependent-card-types"],
      CardType,
      "--dependent-card-types",
    ),
    "include-personal-collections": args["include-personal-collections"] ? true : undefined,
    "sort-column": parseEnum(args["sort-column"], DependentsSortColumn, "--sort-column"),
    "sort-direction": parseEnum(args["sort-direction"], SortDirection, "--sort-direction"),
  };
}

export const queryFlag = {
  query: {
    type: "string",
    description: "Keep entities whose name or location contains this text (case-insensitive)",
  },
} as const;

export const itemFilterFlags = {
  types: listFlag({
    type: "string",
    description: `Comma-separated entity kinds to list: ${DependencyType.options.join(LIST_SEPARATOR)}`,
  }),
  "card-types": listFlag({
    type: "string",
    description: `Comma-separated card kinds to list (narrows cards only): ${CardType.options.join(LIST_SEPARATOR)}`,
  }),
  ...queryFlag,
  "sort-column": {
    type: "string",
    description: `Sort by: ${DependencyItemsSortColumn.options.join("|")} (default: name)`,
  },
  ...sharedFilterFlags,
} as const;

export function readItemFilters(
  args: FlagValues<typeof itemFilterFlags>,
): DependencyItemListParams {
  return {
    types: parseEnumCsv(args.types, DependencyType, "--types"),
    "card-types": parseEnumCsv(args["card-types"], CardType, "--card-types"),
    query: parseOptionalText(args.query, "--query"),
    "include-personal-collections": args["include-personal-collections"] ? true : undefined,
    "sort-column": parseEnum(args["sort-column"], DependencyItemsSortColumn, "--sort-column"),
    "sort-direction": parseEnum(args["sort-direction"], SortDirection, "--sort-direction"),
  };
}
