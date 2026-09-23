import type { RequestOptions, Transport } from "../http/transport";

const METADATA_EXPORT_PATH = "/api/ee/serialization/metadata/export";

// Every section is opt-in on the wire, so a caller names the ones it wants.
export interface MetadataExportParams {
  "with-databases": boolean;
  "with-tables": boolean;
  "with-fields": boolean;
}

export function metadataExportResource(transport: Transport) {
  /**
   * Stream the warehouse metadata (databases, tables and fields) visible to the current user as
   * one JSON document; references between rows are numeric ids. The document can be arbitrarily
   * large, so it is handed back as bytes for the caller to spool to a file.
   */
  async function download(
    params: MetadataExportParams,
    options: RequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    await transport.require("metadataExport.download", options);
    return transport.requestStream(METADATA_EXPORT_PATH, {
      ...options,
      method: "POST",
      query: {
        "with-databases": params["with-databases"],
        "with-tables": params["with-tables"],
        "with-fields": params["with-fields"],
      },
    });
  }

  return { download };
}
