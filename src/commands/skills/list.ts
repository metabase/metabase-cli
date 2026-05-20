import { z } from "zod";

import { loadVisibleSkills } from "../../core/skills";
import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SkillSummary = z.object({
  name: z.string(),
  description: z.string(),
});
export type SkillSummaryJson = z.infer<typeof SkillSummary>;

export const SkillListEnvelope = listEnvelopeSchema(SkillSummary);

const skillSummaryView: ResourceView<SkillSummaryJson> = {
  compactPick: SkillSummary,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "list",
    description:
      "List skills bundled with this CLI. Hidden discovery stubs are omitted from the default listing.",
  },
  args: { ...outputFlags },
  outputSchema: SkillListEnvelope,
  examples: ["mb skills list", "mb skills list --json"],
  run({ ctx }) {
    const items: SkillSummaryJson[] = loadVisibleSkills().map((s) => ({
      name: s.name,
      description: s.description,
    }));
    renderList(wrapList(items), skillSummaryView, ctx);
  },
});
