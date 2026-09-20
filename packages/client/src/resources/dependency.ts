import { z } from "zod";

import type { CardType } from "../domain/card";
import {
  BreakingSource,
  DependencyEntity,
  DependencyGraph,
  type DependencyItemsSortColumn,
  DependencyNode,
  type DependencyType,
  type DependentsSortColumn,
} from "../domain/dependency";
import type { SortDirection } from "../domain/query";
import type { QueryValue, RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";

const DependencyNodeApiList = z.array(DependencyNode);
const DependencyEntityApiList = z.array(DependencyEntity);

export interface DependencyDependentsParams {
  "dependent-types"?: ReadonlyArray<DependencyType> | undefined;
  "dependent-card-types"?: ReadonlyArray<CardType> | undefined;
  broken?: boolean | undefined;
  query?: string | undefined;
  "include-personal-collections"?: boolean | undefined;
  "sort-column"?: DependentsSortColumn | undefined;
  "sort-direction"?: SortDirection | undefined;
}

export type DependencyBrokenParams = Omit<DependencyDependentsParams, "broken" | "query">;

export interface DependencyItemListParams {
  types?: ReadonlyArray<DependencyType> | undefined;
  "card-types"?: ReadonlyArray<CardType> | undefined;
  query?: string | undefined;
  "include-personal-collections"?: boolean | undefined;
  "sort-column"?: DependencyItemsSortColumn | undefined;
  "sort-direction"?: SortDirection | undefined;
}

export type DependencyItemPageOptions = Omit<PaginateOptions, "query">;

export function dependencyResource(transport: Transport) {
  /**
   * The upstream dependency graph of one entity. `nodes` holds the starting entity plus every
   * entity it depends on, directly or transitively; each edge runs from the dependent to what it
   * depends on.
   */
  async function graph(
    type: DependencyType,
    id: number,
    options: RequestOptions = {},
  ): Promise<DependencyGraph> {
    await transport.require("dependency.graph", options);
    return transport.requestParsed(DependencyGraph, "/api/ee/dependencies/graph", {
      ...options,
      query: { type, id },
    });
  }

  /**
   * The entities that depend directly on one entity. `dependent-types` and `dependent-card-types`
   * narrow which kinds are listed, `broken` keeps only those whose query the entity has broken,
   * `query` matches against names and locations, `include-personal-collections` admits content in
   * personal collections, and `sort-column` / `sort-direction` order the result.
   */
  async function dependents(
    type: DependencyType,
    id: number,
    params: DependencyDependentsParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DependencyNode>> {
    await transport.require("dependency.dependents", options);
    const data = await transport.requestParsed(
      DependencyNodeApiList,
      "/api/ee/dependencies/graph/dependents",
      {
        ...options,
        query: {
          type,
          id,
          "dependent-types": params["dependent-types"],
          "dependent-card-types": params["dependent-card-types"],
          broken: params.broken,
          query: params.query,
          "include-personal-collections": params["include-personal-collections"],
          "sort-column": params["sort-column"],
          "sort-direction": params["sort-direction"],
        },
      },
    );
    return { data, total: null };
  }

  /**
   * The dependents of one entity whose queries it has broken, as bare entities without a
   * dependents count. `dependent-types` and `dependent-card-types` narrow which kinds are listed,
   * `include-personal-collections` admits content in personal collections, and `sort-column` /
   * `sort-direction` order the result.
   */
  async function broken(
    type: DependencyType,
    id: number,
    params: DependencyBrokenParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DependencyEntity>> {
    await transport.require("dependency.broken", options);
    const data = await transport.requestParsed(
      DependencyEntityApiList,
      "/api/ee/dependencies/graph/broken",
      {
        ...options,
        query: {
          type,
          id,
          "dependent-types": params["dependent-types"],
          "dependent-card-types": params["dependent-card-types"],
          "include-personal-collections": params["include-personal-collections"],
          "sort-column": params["sort-column"],
          "sort-direction": params["sort-direction"],
        },
      },
    );
    return { data, total: null };
  }

  /**
   * Walk the entities nothing depends on, one page at a time. `types` and `card-types` narrow
   * which kinds are listed, `query` matches against names and locations,
   * `include-personal-collections` admits content in personal collections, and `sort-column` /
   * `sort-direction` order the result. This endpoint pages on the server, so the caller consumes
   * pages and decides how far to pull.
   */
  async function* unreferencedPages(
    params: DependencyItemListParams = {},
    options: DependencyItemPageOptions = {},
  ): AsyncIterable<Page<DependencyNode>> {
    await transport.require("dependency.unreferencedPages", options);
    yield* paginatePages(transport, "/api/ee/dependencies/graph/unreferenced", DependencyNode, {
      query: itemListQuery(params),
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  /**
   * Walk the entities whose dependents carry analysis errors, one page at a time, each with the
   * `dependents_errors` rows found downstream of it. The server lists cards and tables unless
   * `types` says otherwise; `card-types`, `query`, `include-personal-collections`, `sort-column`
   * and `sort-direction` read as on `unreferencedPages`. This endpoint pages on the server, so the
   * caller consumes pages and decides how far to pull.
   */
  async function* breakingPages(
    params: DependencyItemListParams = {},
    options: DependencyItemPageOptions = {},
  ): AsyncIterable<Page<BreakingSource>> {
    await transport.require("dependency.breakingPages", options);
    yield* paginatePages(transport, "/api/ee/dependencies/graph/breaking", BreakingSource, {
      query: itemListQuery(params),
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  return { graph, dependents, broken, unreferencedPages, breakingPages };
}

function itemListQuery(params: DependencyItemListParams): Record<string, QueryValue> {
  return {
    types: params.types,
    "card-types": params["card-types"],
    query: params.query,
    "include-personal-collections": params["include-personal-collections"],
    "sort-column": params["sort-column"],
    "sort-direction": params["sort-direction"],
  };
}
