import { ContentTranslationUploadResult } from "../domain/content-translation";
import type { RequestOptions, Transport } from "../http/transport";

import { buildCsvFormData, type CsvFile } from "./csv-upload";

const CONTENT_TRANSLATION_PATH = "/api/ee/content-translation";

export function contentTranslationResource(transport: Transport) {
  /** Download the complete content translation dictionary as CSV. */
  async function download(options: RequestOptions = {}): Promise<ReadableStream<Uint8Array>> {
    return transport.requestStream(`${CONTENT_TRANSLATION_PATH}/csv`, options);
  }

  /** Replace the complete content translation dictionary with the attached CSV. */
  async function upload(
    file: CsvFile,
    options: RequestOptions = {},
  ): Promise<ContentTranslationUploadResult> {
    const form = buildCsvFormData(file);
    return transport.requestParsed(
      ContentTranslationUploadResult,
      `${CONTENT_TRANSLATION_PATH}/upload-dictionary`,
      {
        ...options,
        method: "POST",
        body: form,
      },
    );
  }

  return { download, upload };
}
