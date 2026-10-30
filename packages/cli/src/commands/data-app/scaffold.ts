import { join } from "node:path";

import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { EMBEDDING_SDK_PACKAGE } from "../../core/embedding-sdk";
import { findSkillByName, loadAllSkills } from "../../core/skills";
import { renderSummary } from "../../output/render";
import { scaffoldDataAppProject } from "../../runtime/data-app-project";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TEMPLATE_SKILL = "data-app";
const TEMPLATE_DIR = "template";

const ScaffoldResult = z.object({ dir: z.string() });
type ScaffoldResult = z.infer<typeof ScaffoldResult>;

const scaffoldResultView: ResourceView<ScaffoldResult> = {
  compactPick: ScaffoldResult,
  tableColumns: [{ key: "dir", label: "Directory" }],
};

export default defineMetabaseCommand({
  meta: { name: "scaffold", description: "Copy the data app project template into a directory" },
  details: `Copies the Vite + React + TypeScript template into <dir> (the current directory by default), which must be missing or empty, and names the package after the directory (lowercase, dashes). It doesn't reach Metabase: create the app with \`mb data-app create\` and fetch its queries and actions with \`mb data-app typed-schema <slug> --out src/metabase.ts\`. Before \`npm install\`, install the SDK tag \`mb data-app sdk-version\` answers for the instance (\`npm install ${EMBEDDING_SDK_PACKAGE}@<tag>\`): the template's \`*\` installs \`latest\`, which may not build the app.`,
  skills: [{ skill: "data-app", purpose: "the steps after scaffolding" }],
  requires: null,
  args: {
    ...outputFlags,
    dir: { type: "positional", description: "Project directory", required: false, default: "." },
  },
  outputSchema: ScaffoldResult,
  examples: ["mb data-app scaffold sales-overview", "mb data-app scaffold ."],
  async run({ args, ctx }) {
    const templateDir = join(findSkillByName(loadAllSkills(), TEMPLATE_SKILL).dir, TEMPLATE_DIR);
    await scaffoldDataAppProject({ dir: args.dir, templateDir });
    renderSummary(
      { dir: args.dir },
      scaffoldResultView,
      `Scaffolded a data app project in ${args.dir}.`,
      ctx,
    );
  },
});
