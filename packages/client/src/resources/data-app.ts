import { z } from "zod";

import {
  DataAppFiles,
  type DataAppGenerateInput,
  DataAppGroup,
  DataAppGroupWarning,
  DataAppListing,
  DataAppResources,
  type DataAppResourcesInput,
} from "../domain/data-app";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

const APPS_PATH = "/api/apps";

function appPath(slug: string): string {
  return `${APPS_PATH}/${encodeURIComponent(slug)}`;
}

export interface DataAppListParams {
  available?: boolean | undefined;
}

export function dataAppResource(transport: Transport) {
  const { explain } = explainer(transport, "dataApp");

  /**
   * List the data apps the caller can open. `available` keeps only enabled apps that are not
   * outdated. An administrator gets every field; anyone else only the slug and the display name.
   */
  async function list(
    params: DataAppListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DataAppListing>> {
    const data = await transport.requestParsed(z.array(DataAppListing), APPS_PATH, {
      ...options,
      query: { available: params.available },
    });
    return { data, total: null };
  }

  /** Get an enabled data app by its slug. An administrator gets every field; anyone else only the slug and the display name. */
  async function get(slug: string, options: RequestOptions = {}): Promise<DataAppListing> {
    return transport.requestParsed(DataAppListing, appPath(slug), { ...options });
  }

  /** Download the JavaScript bundle an enabled data app is served from. */
  async function bundle(slug: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const response = await transport.requestRaw(`${appPath(slug)}/bundle`, {
      ...options,
      expectContentType: "binary",
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * A new data app's `data_app.yaml` and its collection's file, each at its path from the
   * repository's top, with new entity ids. Writes nothing on the instance. Administrators only.
   */
  async function generateApp(
    params: DataAppGenerateInput,
    options: RequestOptions = {},
  ): Promise<DataAppFiles> {
    return transport.requestParsed(DataAppFiles, `${APPS_PATH}/generate/app`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * The TypeScript module a data app's definitions are written against: the Library's published
   * tables and metrics, and the query actions that belong to no model. Administrators only.
   */
  async function generateSchemas(options: RequestOptions = {}): Promise<string> {
    const response = await transport.requestRaw(`${APPS_PATH}/generate/schemas`, {
      ...options,
      expectContentType: "text",
    });
    return response.text();
  }

  /**
   * The files of a data app's collection its definitions build: a saved question per query, a copy
   * per action and a copy of each metric the queries aggregate, each answered on its own with its
   * file or the error that stops it. Writes nothing on the instance. Administrators only.
   */
  async function generateResources(
    params: DataAppResourcesInput,
    options: RequestOptions = {},
  ): Promise<DataAppResources> {
    return transport.requestParsed(DataAppResources, `${APPS_PATH}/generate/resources`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** List the groups assigned to a data app. Administrators only. */
  async function groups(
    slug: string,
    options: RequestOptions = {},
  ): Promise<ListResult<DataAppGroup>> {
    const data = await transport.requestParsed(z.array(DataAppGroup), `${appPath(slug)}/groups`, {
      ...options,
    });
    return { data, total: null };
  }

  /** For each group assigned to a data app, the tables it reads that the group cannot view. Administrators only. */
  async function groupPermissionWarnings(
    slug: string,
    options: RequestOptions = {},
  ): Promise<ListResult<DataAppGroupWarning>> {
    const data = await transport.requestParsed(
      z.array(DataAppGroupWarning),
      `${appPath(slug)}/group-permission-warnings`,
      { ...options },
    );
    return { data, total: null };
  }

  return {
    list: explain("list", list),
    get: explain("get", get),
    bundle: explain("bundle", bundle),
    generateApp: explain("generateApp", generateApp),
    generateSchemas: explain("generateSchemas", generateSchemas),
    generateResources: explain("generateResources", generateResources),
    groups: explain("groups", groups),
    groupPermissionWarnings: explain("groupPermissionWarnings", groupPermissionWarnings),
  };
}
