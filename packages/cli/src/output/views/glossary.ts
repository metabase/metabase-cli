import { type Glossary, GlossaryCompact } from "@metabase/client/domain/glossary";

import type { ResourceView } from "../view";

export const glossaryView: ResourceView<Glossary> = {
  compactPick: GlossaryCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "term", label: "Term" },
    { key: "definition", label: "Definition" },
  ],
};
