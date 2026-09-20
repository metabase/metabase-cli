import { z } from "zod";

import { Glossary, type GlossaryCreateInput, type GlossaryUpdateInput } from "../domain/glossary";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/glossary` wraps its rows in a `{ data }` envelope that carries no count, so the total a
// caller reads off `ListResult` is the array's own length and the server reports none.
const GlossaryApiList = z.object({ data: z.array(Glossary) }).loose();

export interface GlossaryListParams {
  search?: string | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function glossaryResource(transport: Transport) {
  /**
   * List glossary entries in term order. `search` keeps the entries whose term or definition
   * contains it, case-insensitively.
   */
  async function list(
    params: GlossaryListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Glossary>> {
    await transport.require("glossary.list", options);
    const response = await transport.requestParsed(GlossaryApiList, "/api/glossary", {
      ...options,
      query: { search: params.search },
    });
    return { data: response.data, total: null };
  }

  /** Create a glossary entry, a term and its definition. Terms are unique. */
  async function create(
    params: GlossaryCreateInput,
    options: RequestOptions = {},
  ): Promise<Glossary> {
    await transport.require("glossary.create", options);
    return transport.requestParsed(Glossary, "/api/glossary", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Replace the term and definition of a glossary entry by id. */
  async function update(
    id: number,
    params: GlossaryUpdateInput,
    options: RequestOptions = {},
  ): Promise<Glossary> {
    await transport.require("glossary.update", options);
    return transport.requestParsed(Glossary, `/api/glossary/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a glossary entry by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("glossary.delete", options);
    await transport.requestRaw(`/api/glossary/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { list, create, update, delete: remove };
}
