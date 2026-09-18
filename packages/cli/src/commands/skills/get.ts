import { ConfigError } from "@metabase/client/errors";

import { readCachedServerProfile } from "../../core/auth/cached-server";
import { resolveProfileName } from "../../core/config";
import {
  loadAllSkills,
  loadVisibleSkills,
  readSkillContent,
  selectForProfile,
  selectSkillsByNames,
  SkillContent,
  type SkillInfo,
} from "../../core/skills";
import { warn } from "../../output/notice";
import { renderListWithExtras, writeText } from "../../output/render";
import { skillFilterNotices, UnavailableSkills, unfilteredFlag } from "../../output/skill-list";
import { listEnvelopeSchemaWithExtras } from "../../output/types";
import type { ResourceView } from "../../output/view";
import { windowList } from "../../output/window";
import { parseCsv } from "../../runtime/csv";
import { listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SkillGetEnvelope = listEnvelopeSchemaWithExtras(SkillContent, {
  unavailable: UnavailableSkills,
});

// A skill is one indivisible document, so the generic advice to narrow the fields or filter the
// list buys nothing: the whole body is what was asked for.
const SKILL_OVERSIZE_HINT =
  "a skill body is indivisible — pass --max-bytes 0 to print it whole, or `mb skills path <name>` to read it from disk";

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
      "Print one or more skills' SKILL.md content, as the profile's server can use it: a skill it lacks the features for is reported under `unavailable`, and a section it cannot use is left out. Pass comma-separated names, or --all for every non-hidden skill. --unfiltered prints the selection as written, regardless of the server. --full includes references and templates.",
  },
  requires: null,
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    names: {
      type: "positional",
      description:
        "Skill name (or comma-separated list). Omit to combine with --all for every non-hidden skill.",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Every non-hidden skill",
    },
    ...unfilteredFlag,
  },
  outputSchema: SkillGetEnvelope,
  examples: [
    "mb skills get core",
    "mb skills get core --full",
    "mb skills get git-sync,transform --json",
    "mb skills get --all --json",
    "mb skills get transform --unfiltered",
  ],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);
    const cached = args.unfiltered === true ? null : await readCachedServerProfile(profileName);
    const profile = cached !== null && cached.kind === "found" ? cached.profile : null;
    const selection = selectForProfile(
      pickSkills({ names: args.names, all: args.all === true }),
      profile,
    );
    const payloads = selection.skills.map((info) =>
      readSkillContent(info, { includeExtras: ctx.full, profile }),
    );

    const envelope = windowList(payloads, ctx.range);
    if (ctx.format === "json") {
      renderListWithExtras(envelope, { unavailable: selection.unavailable }, skillContentView, {
        ...ctx,
        oversizeHint: SKILL_OVERSIZE_HINT,
      });
      return;
    }
    if (envelope.data.length > 0) {
      writeText(renderText(envelope.data, ctx.full));
    }
    for (const notice of skillFilterNotices(selection.unavailable, { profileName, cached })) {
      warn(notice);
    }
  },
});

interface PickSkillsArgs {
  names: string | undefined;
  all: boolean;
}

function pickSkills({ names, all }: PickSkillsArgs): SkillInfo[] {
  if (names !== undefined) {
    return selectSkillsByNames(loadAllSkills(), parseCsv(names));
  }
  if (all) {
    return loadVisibleSkills();
  }
  throw new ConfigError("provide a skill name (comma-separated for multiple) or --all");
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
