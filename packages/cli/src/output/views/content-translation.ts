import { ContentTranslationUploadResult } from "@metabase/client/domain/content-translation";

import type { ResourceView } from "../view";

export const contentTranslationUploadView: ResourceView<ContentTranslationUploadResult> = {
  compactPick: ContentTranslationUploadResult,
  tableColumns: [{ key: "success", label: "Success" }],
};
