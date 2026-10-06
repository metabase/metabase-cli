import { type EidTranslateInput, EidTranslateResult } from "../domain/eid-translation";
import type { RequestOptions, Transport } from "../http/transport";

export function eidTranslationResource(transport: Transport) {
  /**
   * Translate entity ids to the numeric ids of the rows they name. The request groups the entity
   * ids by model; the response is keyed by entity id, each entry carrying its model and — when the
   * lookup succeeded — the numeric id.
   */
  async function translate(
    params: EidTranslateInput,
    options: RequestOptions = {},
  ): Promise<EidTranslateResult> {
    return transport.requestParsed(EidTranslateResult, "/api/eid-translation/translate", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { translate };
}
