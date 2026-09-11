import {
  DataSensitivityDatabaseResult,
  DataSensitivityTableResult,
} from "../domain/data-sensitivity";
import type { RequestOptions, Transport } from "../http/transport";

const DATA_SENSITIVITY_PATH = "/api/ee/data-sensitivity";

export interface DataSensitivityDatabaseParams {
  schema?: string | undefined;
}

// Every path parameter is a numeric id, so none needs encoding. Neither method opts into retries: a
// resend spends provider tokens on a scan the server may already be running.
export function dataSensitivityResource(transport: Transport) {
  /** Classify every active field of a table with the LLM and diff the proposals against the current `data_sensitivity` labels. Synchronous; writes nothing. */
  async function classifyTable(
    id: number,
    options: RequestOptions = {},
  ): Promise<DataSensitivityTableResult> {
    return transport.requestParsed(
      DataSensitivityTableResult,
      `${DATA_SENSITIVITY_PATH}/table/${id}`,
      { ...options, method: "POST" },
    );
  }

  /** Classify every active table of a database, or only those in `schema`, with the LLM and diff the proposals against the current `data_sensitivity` labels. Synchronous; writes nothing. */
  async function classifyDatabase(
    id: number,
    params: DataSensitivityDatabaseParams = {},
    options: RequestOptions = {},
  ): Promise<DataSensitivityDatabaseResult> {
    return transport.requestParsed(
      DataSensitivityDatabaseResult,
      `${DATA_SENSITIVITY_PATH}/database/${id}`,
      { ...options, method: "POST", body: { schema: params.schema } },
    );
  }

  return { classifyTable, classifyDatabase };
}
