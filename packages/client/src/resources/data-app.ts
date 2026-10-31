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

  /** Get one data app by slug; admins read disabled apps too. */
  async function get(slug: string, options: RequestOptions = {}): Promise<DataAppEntry> {
    return transport.requestParsed(DataAppEntry, appPath(slug), { ...options });
  }

  /** Enable or disable a data app; anything else about an app changes only through a repository import. */
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
    generateSchema: explain("generateSchema", generateSchema),
    generateQueries: explain("generateQueries", generateQueries),
    generateActions: explain("generateActions", generateActions),
  };
}
