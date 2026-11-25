import { z } from "zod";

import {
  DataAppEntry,
  type DataAppGenerateActionsInput,
  type DataAppGenerateQueriesInput,
  DataAppGeneratedFiles,
  DataApp,
  type DataAppUpdateInput,
} from "../domain/data-app";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

const DATA_APPS_PATH = "/api/ee/apps";

function appPath(slug: string): string {
  return `${DATA_APPS_PATH}/${encodeURIComponent(slug)}`;
}

export function dataAppResource(transport: Transport) {
  const { explain } = explainer(transport, "dataApp");

  /** List the data apps. `GET /api/ee/apps` answers a bare array. */
  async function list(options: RequestOptions = {}): Promise<ListResult<DataAppEntry>> {
    const data = await transport.requestParsed(z.array(DataAppEntry), DATA_APPS_PATH, {
      ...options,
    });
    return { data, total: null };
  }

  /** Get one data app by its slug; admins read disabled apps too. */
  async function get(slug: string, options: RequestOptions = {}): Promise<DataAppEntry> {
    return transport.requestParsed(DataAppEntry, appPath(slug), { ...options });
  }

  /**
   * Enable or disable a data app. A disabled app is served to admins alone; an app otherwise changes
   * only through a repository import.
   */
  async function update(
    slug: string,
    params: DataAppUpdateInput,
    options: RequestOptions = {},
  ): Promise<DataApp> {
    return transport.requestParsed(DataApp, appPath(slug), {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Read a data app's bundle, the text of its built JavaScript; admins read a disabled app's too. */
  async function getBundle(slug: string, options: RequestOptions = {}): Promise<string> {
    const response = await transport.requestRaw(`${appPath(slug)}/bundle`, {
      ...options,
      method: "GET",
      expectContentType: "binary",
    });
    return response.text();
  }

  /** An app's `src/metabase.schema.ts`: the Library's published tables, with their fields, segments and measures, and the Library's metrics. */
  async function generateSchema(options: RequestOptions = {}): Promise<DataAppGeneratedFiles> {
    return transport.requestParsed(DataAppGeneratedFiles, `${DATA_APPS_PATH}/generate/schema`, {
      ...options,
    });
  }

  /** The YAML files of the questions an app's `defineQuery` exports define, by file name in its collection's directory. */
  async function generateQueries(
    params: DataAppGenerateQueriesInput,
    options: RequestOptions = {},
  ): Promise<DataAppGeneratedFiles> {
    return transport.requestParsed(DataAppGeneratedFiles, `${DATA_APPS_PATH}/generate/queries`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** The YAML files of the implicit actions an app's `defineAction` exports define, by file name in its collection's directory. */
  async function generateActions(
    params: DataAppGenerateActionsInput,
    options: RequestOptions = {},
  ): Promise<DataAppGeneratedFiles> {
    return transport.requestParsed(DataAppGeneratedFiles, `${DATA_APPS_PATH}/generate/actions`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return {
    list: explain("list", list),
    get: explain("get", get),
    update: explain("update", update),
    getBundle: explain("getBundle", getBundle),
    generateSchema: explain("generateSchema", generateSchema),
    generateQueries: explain("generateQueries", generateQueries),
    generateActions: explain("generateActions", generateActions),
  };
}
