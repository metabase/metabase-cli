import { z } from "zod";

import { Document, type DocumentCreateInput, type DocumentUpdateInput } from "../domain/document";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/document` wraps its rows in `{ items }` and reports no count, so the total a caller
// reads off `ListResult` is the array's own length.
const DocumentApiList = z.object({ items: z.array(Document) }).loose();

export function documentResource(transport: Transport) {
  /** Get existing documents. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Document>> {
    const response = await transport.requestParsed(DocumentApiList, "/api/document", {
      ...options,
    });
    return { data: response.items, total: null };
  }

  /** Return an existing document by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Document> {
    return transport.requestParsed(Document, `/api/document/${id}`, { ...options });
  }

  /** Create a new document. */
  async function create(
    params: DocumentCreateInput,
    options: RequestOptions = {},
  ): Promise<Document> {
    return transport.requestParsed(Document, "/api/document", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update an existing document by id. */
  async function update(
    id: number,
    params: DocumentUpdateInput,
    options: RequestOptions = {},
  ): Promise<Document> {
    return transport.requestParsed(Document, `/api/document/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a document by id. Metabase models this as an update, not its own endpoint. */
  async function archive(id: number, options: RequestOptions = {}): Promise<Document> {
    return update(id, { archived: true }, options);
  }

  return { list, get, create, update, archive };
}
