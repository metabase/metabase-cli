import {
  type EidTranslateResult,
  EidTranslateResultCompact,
} from "@metabase/client/domain/eid-translation";

import type { ResourceView } from "../view";

export const eidTranslateView: ResourceView<EidTranslateResult> = {
  compactPick: EidTranslateResultCompact,
  tableColumns: [{ key: "entity_ids", label: "Translated" }],
};
