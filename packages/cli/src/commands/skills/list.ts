import { z } from "zod";

import type { ResourceView } from "../../output/view";

import { readCachedServerProfile } from "../../core/auth/cached-server";
import { resolveProfileName } from "../../core/config";
import { loadVisibleSkills, selectForProfile } from "../../core/skills";
import { renderListWithExtras } from "../../output/render";
import {
  renderSkillList,
  skillFilterNotices,
  UnavailableSkills,
  unfilteredFlag,
} from "../../output/skill-list";
import { listEnvelopeSchemaWithExtras } from "../../output/types";
import { windowList } from "../../output/window";
import { warn } from "../../output/notice";
import { listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const SkillSummary = z.object({
  name: z.string(),
  description: z.string(),
});
type SkillSummaryJson = z.infer<typeof SkillSummary>;

export const SkillListEnvelope = listEnvelopeSchemaWithExtras(SkillSummary, {
  unavailable: UnavailableSkills,
});

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
      "List CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow. Skills the profile's server cannot use are left out; --unfiltered lists them too.",
  },
  requires: null,
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...unfilteredFlag },
  outputSchema: SkillListEnvelope,
  examples: ["mb skills list", "mb skills list --json", "mb skills list --unfiltered"],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);
    const cached = args.unfiltered === true ? null : await readCachedServerProfile(profileName);
    const profile = cached !== null && cached.kind === "found" ? cached.profile : null;
    const selection = selectForProfile(loadVisibleSkills(), profile);
    const items: SkillSummaryJson[] = selection.skills.map((s) => ({
      name: s.name,
      description: s.description,
    }));
    const envelope = windowList(items, ctx.range);
    if (ctx.format === "json" || ctx.fields !== undefined || ctx.full) {
      renderListWithExtras(envelope, { unavailable: selection.unavailable }, skillSummaryView, ctx);
    } else {
      renderSkillList(envelope.data, ctx.maxBytes);
    }
    if (ctx.format === "json") {
      return;
    }
    for (const notice of skillFilterNotices(selection.unavailable, { profileName, cached })) {
      warn(notice);
    }
  },
});
