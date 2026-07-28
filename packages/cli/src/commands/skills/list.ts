import { z } from "zod";

import type { ResourceView } from "../../output/view";

import { loadVisibleSkills } from "../../core/skills";
import { renderList } from "../../output/render";
import { renderSkillList } from "../../output/skill-list";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const SkillSummary = z.object({
  name: z.string(),
  description: z.string(),
});
type SkillSummaryJson = z.infer<typeof SkillSummary>;

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
      "List CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.",
  },
  capabilities: null,
  args: { ...outputFlags, ...listFlags },
  outputSchema: SkillListEnvelope,
  examples: ["mb skills list", "mb skills list --json"],
  run({ ctx }) {
    const items: SkillSummaryJson[] = loadVisibleSkills().map((s) => ({
      name: s.name,
      description: s.description,
    }));
    const envelope = windowList(items, ctx.range);
    if (ctx.format === "json" || ctx.fields !== undefined || ctx.full) {
      renderList(envelope, skillSummaryView, ctx);
      return;
    }
    renderSkillList(envelope.data, ctx.maxBytes);
  },
});
