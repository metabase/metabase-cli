import { z } from "zod";

import {
  TransformTest,
  type TransformTestCreateInput,
  TransformTestRefusal,
  TransformTestRunResult,
  type TransformTestUpdateInput,
} from "../domain/transform-test";
import { HttpError } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import { parseJsonResult } from "../json";
import type { ListResult } from "../list";

// `GET /api/ee/transform-test` answers a bare array rather than a `{ data, total }` envelope, so
// the count a caller reads off `ListResult` is the array's own length and the server reports none.
const TransformTestApiList = z.array(TransformTest);

export interface TransformTestListParams {
  "transform-id"?: number | undefined;
}

// A refusal is the server declining to run at all, published as a closed vocabulary a caller can
// switch on. It stays an `HttpError` (rebuilt from the original's detail, as `chainRequestFailure`
// does) so `status`, `kind` and `fieldErrors` survive for a caller that reads those instead.
export class TransformTestRefusalError extends HttpError {
  readonly refusal: TransformTestRefusal;

  constructor(cause: HttpError, refusal: TransformTestRefusal) {
    super({
      status: cause.status,
      statusText: cause.developerDetail.statusText,
      method: cause.developerDetail.method,
      url: cause.developerDetail.url,
      responseHeaders: cause.developerDetail.responseHeaders,
      rawBody: cause.developerDetail.body,
    });
    this.name = "TransformTestRefusalError";
    this.refusal = refusal;
  }
}

async function refusing<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof HttpError) || error.developerDetail.body === null) {
      throw error;
    }
    const parsed = parseJsonResult(error.developerDetail.body, TransformTestRefusal);
    throw parsed.ok ? new TransformTestRefusalError(error, parsed.value) : error;
  }
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformTestResource(transport: Transport) {
  /** List the transform tests, optionally only those of one transform. */
  async function list(
    params: TransformTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<TransformTest>> {
    await transport.require("transformTest.list", options);
    const data = await transport.requestParsed(TransformTestApiList, "/api/ee/transform-test", {
      ...options,
      query: { "transform-id": params["transform-id"] },
    });
    return { data, total: null };
  }

  /** Get a transform test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformTest> {
    await transport.require("transformTest.get", options);
    return transport.requestParsed(TransformTest, `/api/ee/transform-test/${id}`, { ...options });
  }

  /**
   * Create a transform test. The server validates the inputs and expectations against the
   * transform before saving, and refuses with a `TransformTestRefusalError` when they cannot run.
   */
  async function create(
    params: TransformTestCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    await transport.require("transformTest.create", options);
    return refusing(() =>
      transport.requestParsed(TransformTest, "/api/ee/transform-test", {
        ...options,
        method: "POST",
        body: params,
      }),
    );
  }

  /**
   * Update a transform test by id, leaving omitted fields unchanged. A body that touches the
   * transform, inputs or expectations is validated as on create, with the same refusal.
   */
  async function update(
    id: number,
    params: TransformTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    await transport.require("transformTest.update", options);
    return refusing(() =>
      transport.requestParsed(TransformTest, `/api/ee/transform-test/${id}`, {
        ...options,
        method: "PUT",
        body: params,
      }),
    );
  }

  /** Delete a transform test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transformTest.delete", options);
    await transport.requestRaw(`/api/ee/transform-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a transform test by id. A result means the run happened: `status` is `passed` or `failed`
   * and every expectation reports what it found, one that could not be evaluated as its own
   * `error`. A `TransformTestRefusalError` means the run was refused and nothing meaningful ran;
   * its `refusal["error-code"]` names which refusal it was.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    await transport.require("transformTest.run", options);
    return refusing(() =>
      transport.requestParsed(TransformTestRunResult, `/api/ee/transform-test/${id}/run`, {
        ...options,
        method: "POST",
      }),
    );
  }

  return { list, get, create, update, delete: remove, run };
}
