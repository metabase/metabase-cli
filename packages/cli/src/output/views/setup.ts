import { type SetupResult, SetupResultCompact } from "@metabase/client/domain/setup";

import type { ResourceView } from "../view";

export const setupResultView: ResourceView<SetupResult> = {
  compactPick: SetupResultCompact,
  tableColumns: [{ key: "id", label: "Session" }],
};
