import { join } from "node:path";

import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { findSkillByName, loadAllSkills } from "../../core/skills";
import { renderSummary } from "../../output/render";
import {
  dataAppDir,
  ignoreLocalEnv,
  scaffoldDataAppProject,
  writeDataAppManifest,
} from "../../runtime/data-app-project";
import { outputFlags } from "../flags";
import { nanoId } from "../nano-id";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

const TEMPLATE_SKILL = "data-app";
const TEMPLATE_DIR = "template";

const ScaffoldResult = z.object({ dir: z.string() });
type ScaffoldResult = z.infer<typeof ScaffoldResult>;

const scaffoldResultView: ResourceView<ScaffoldResult> = {
  compactPick: ScaffoldResult,
  tableColumns: [{ key: "dir", label: "Directory" }],
};

export default defineMetabaseCommand({
  meta: {
    name: "scaffold",
    description: "Scaffold a data app in the synced repository, from its root",
  },
  details:
    "Run from the root of the synced git repository. Copies the Vite + React + TypeScript template into `data_apps/<slug>/`, which must be missing or empty, and writes the app's `data_app.yaml` and its collection's file under `collections/data_apps/`, with new entity IDs, and adds `.env.local`, which holds the dev preview's API key, to the repository's `.gitignore`. It doesn't reach Metabase: the app exists there once the repository is imported. Before `npm install`, install the SDK's beta tag for the instance's version, e.g. `npm install @metabase/embedding-sdk-react@66-beta` for v1.66.x: the template's `*` installs `latest`, which may not build the app.",
  skills: [{ skill: "data-app", purpose: "the steps after scaffolding" }],
  requires: null,
  args: { ...outputFlags, ...slugArg },
  outputSchema: ScaffoldResult,
  examples: ["mb data-app scaffold sales-overview"],
  async run({ args, ctx }) {
    const slug = parseSlug(args.slug);
    const dir = dataAppDir(slug);
    const templateDir = join(findSkillByName(loadAllSkills(), TEMPLATE_SKILL).dir, TEMPLATE_DIR);
    await scaffoldDataAppProject({ dir, templateDir });
    await writeDataAppManifest({ slug, entityId: nanoId(), collectionEntityId: nanoId() });
    await ignoreLocalEnv(".gitignore");
    renderSummary({ dir }, scaffoldResultView, `Scaffolded data app ${slug} in ${dir}.`, ctx);
  },
});
