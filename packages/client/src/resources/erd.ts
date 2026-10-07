import { Erd } from "../domain/erd";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

const ERD_PATH = "/api/ee/erd";

export interface ErdParams {
  "database-id": number;
  "table-ids"?: readonly number[] | undefined;
  schema?: string | undefined;
}

export function erdResource(transport: Transport) {
  const { explain } = explainer(transport, "erd");

  /**
   * Get the entity relationship diagram of a database: the readable tables as nodes, each with its
   * fields, and the foreign keys between them as edges. `table-ids` makes those tables the focal
   * points and draws their neighbours; `schema` keeps one schema, the empty string the tables with
   * none.
   */
  async function get(params: ErdParams, options: RequestOptions = {}): Promise<Erd> {
    return transport.requestParsed(Erd, ERD_PATH, {
      ...options,
      query: {
        "database-id": params["database-id"],
        "table-ids": params["table-ids"],
        schema: params.schema,
      },
    });
  }

  return { get: explain("get", get) };
}
