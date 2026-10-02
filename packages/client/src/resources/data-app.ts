import { z } from "zod";

import {
  DataApp,
  type DataAppCreateInput,
  DataAppEntry,
  type DataAppListFilter,
  DataAppPermissionWarning,
  type DataAppPermissionWarningsInput,
  DataAppRepoStatus,
  type DataAppUpdateInput,
  type TypedSchemaScope,
} from "../domain/data-app";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

const DATA_APPS_PATH = "/api/apps";

function appPath(slug: string): string {
  return `${DATA_APPS_PATH}/${encodeURIComponent(slug)}`;
}

export function dataAppResource(transport: Transport) {
  /** List the data apps; `available` keeps only enabled, published apps. `GET /api/apps` answers a bare array. */
  async function list(
    filter: DataAppListFilter = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DataAppEntry>> {
    await transport.require("dataApp.list", options);
    const data = await transport.requestParsed(z.array(DataAppEntry), DATA_APPS_PATH, {
      ...options,
      query: { available: filter.available },
    });
    return { data, total: null };
  }

  /** Get one enabled data app by slug. */
  async function get(slug: string, options: RequestOptions = {}): Promise<DataAppEntry> {
    await transport.require("dataApp.get", options);
    return transport.requestParsed(DataAppEntry, appPath(slug), { ...options });
  }

  /** Create a data app from its manifest fields and bundle text; a draft with the same slug becomes the app. */
  async function create(
    params: DataAppCreateInput,
    options: RequestOptions = {},
  ): Promise<DataApp> {
    await transport.require("dataApp.create", options);
    return transport.requestParsed(DataApp, DATA_APPS_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a data app's manifest fields or bundle, or enable or disable it. */
  async function update(
    slug: string,
    params: DataAppUpdateInput,
    options: RequestOptions = {},
  ): Promise<DataApp> {
    await transport.require("dataApp.update", options);
    return transport.requestParsed(DataApp, appPath(slug), {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a data app with its bundle and the collection and permission group it owns. */
  async function remove(slug: string, options: RequestOptions = {}): Promise<void> {
    await transport.require("dataApp.delete", options);
    await transport.requestRaw(appPath(slug), {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /** Create or reuse the draft that reserves a slug and the app's resources before the app exists. */
  async function draft(slug: string, options: RequestOptions = {}): Promise<DataApp> {
    await transport.require("dataApp.draft", options);
    return transport.requestParsed(DataApp, `${appPath(slug)}/draft`, {
      ...options,
      method: "POST",
    });
  }

  /** Whether a repository is connected for data apps, and its URL. */
  async function repoStatus(options: RequestOptions = {}): Promise<DataAppRepoStatus> {
    await transport.require("dataApp.repoStatus", options);
    return transport.requestParsed(DataAppRepoStatus, `${DATA_APPS_PATH}/repo-status`, {
      ...options,
    });
  }

  /** The users among `user_ids` who cannot read every table the app uses, with the tables they miss. */
  async function permissionWarnings(
    slug: string,
    params: DataAppPermissionWarningsInput,
    options: RequestOptions = {},
  ): Promise<DataAppPermissionWarning[]> {
    await transport.require("dataApp.permissionWarnings", options);
    return transport.requestParsed(
      z.array(DataAppPermissionWarning),
      `${appPath(slug)}/user-permission-warnings`,
      { ...options, method: "POST", body: params },
    );
  }

  /** The TypeScript semantic schema module (`metabase.data.ts`) for `scope`. */
  async function schema(scope: TypedSchemaScope, options: RequestOptions = {}): Promise<string> {
    await transport.require("dataApp.schema", options);
    const response = await transport.requestRaw("/api/typed-schemas/v1/typescript", {
      ...options,
      expectContentType: "text",
      query: {
        database: scope.database,
        "library-collections": scope.libraryCollections?.join(","),
        "include-data-library": scope.includeDataLibrary,
        "include-metric-library": scope.includeMetricLibrary,
        "include-models": scope.includeModels,
      },
    });
    return response.text();
  }

  return {
    list,
    get,
    create,
    update,
    delete: remove,
    draft,
    repoStatus,
    permissionWarnings,
    schema,
  };
}
