import { z } from "zod";

import { findSkillByName, loadAllSkills, loadVisibleSkills } from "../../core/skills";
import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SkillPath = z.object({
  name: z.string(),
  dir: z.string(),
});
export type SkillPathJson = z.infer<typeof SkillPath>;

export const SkillPathListEnvelope = listEnvelopeSchema(SkillPath);

const skillPathView: ResourceView<SkillPathJson> = {
  compactPick: SkillPath,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "dir", label: "Path" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "path",
    description:
      "Print the absolute path to a skill (or all skills). Useful when an agent needs to read the SKILL.md or its references with the Read tool directly.",
  },
  args: {
    ...outputFlags,
    name: {
      type: "positional",
      description: "Skill name (omit to list every non-hidden skill)",
      required: false,
    },
  },
  outputSchema: SkillPathListEnvelope,
  examples: ["mb skills path", "mb skills path core", "mb skills path core --json"],
  run({ args, ctx }) {
    const items =
      args.name === undefined
        ? loadVisibleSkills().map(toSkillPath)
        : [toSkillPath(findSkillByName(loadAllSkills(), args.name))];
    renderList(wrapList(items), skillPathView, ctx);
  },
});

function toSkillPath(info: { name: string; dir: string }): SkillPathJson {
  return { name: info.name, dir: info.dir };
}
