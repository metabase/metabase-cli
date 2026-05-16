import { ConfigError } from "../../core/errors";
import {
  loadAllSkills,
  loadVisibleSkills,
  readSkillContent,
  selectSkillsByNames,
  SkillContent,
  type SkillInfo,
} from "../../core/skills";
import type { ResourceView } from "../../domain/view";
import { renderList, writeText } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { parseCsv } from "../../runtime/csv";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SkillGetEnvelope = listEnvelopeSchema(SkillContent);

const skillContentView: ResourceView<SkillContent> = {
  compactPick: SkillContent,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description:
      "Print one or more skills' SKILL.md content. Pass comma-separated names, or --all for every non-hidden skill. --full includes references and templates.",
  },
  args: {
    ...outputFlags,
    names: {
      type: "positional",
      description: "Skill name (or comma-separated list). Omit when using --all.",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Fetch every non-hidden skill",
    },
  },
  outputSchema: SkillGetEnvelope,
  examples: [
    "mb skills get core",
    "mb skills get core --full",
    "mb skills get workspace,transform --json",
    "mb skills get --all --json",
  ],
  run({ args, ctx }) {
    const selected = pickSkills({ names: args.names, all: args.all === true });
    const payloads = selected.map((info) => readSkillContent(info, { includeExtras: ctx.full }));

    if (ctx.format === "json") {
      renderList(wrapList(payloads), skillContentView, ctx);
      return;
    }
    writeText(renderText(payloads, ctx.full));
  },
});

interface PickSkillsArgs {
  names: string | undefined;
  all: boolean;
}

function pickSkills({ names, all }: PickSkillsArgs): SkillInfo[] {
  if (all && names !== undefined) {
    throw new ConfigError("--all conflicts with a positional skill name");
  }
  if (all) {
    return loadVisibleSkills();
  }
  if (names === undefined) {
    throw new ConfigError("provide a skill name (comma-separated for multiple) or --all");
  }
  return selectSkillsByNames(loadAllSkills(), parseCsv(names));
}

function renderText(payloads: readonly SkillContent[], includeExtras: boolean): string {
  return payloads.map((payload) => renderTextSection(payload, includeExtras)).join("\n\n");
}

function renderTextSection(payload: SkillContent, includeExtras: boolean): string {
  const parts = [payload.body.trimEnd()];
  if (!includeExtras) {
    return parts.join("\n\n");
  }
  for (const ref of payload.references) {
    parts.push(extraFileHeader(payload.name, ref.path), ref.content.trimEnd());
  }
  for (const tpl of payload.templates) {
    parts.push(extraFileHeader(payload.name, tpl.path), tpl.content.trimEnd());
  }
  return parts.join("\n\n");
}

function extraFileHeader(skillName: string, relPath: string): string {
  return `=== ${skillName}/${relPath} ===`;
}
