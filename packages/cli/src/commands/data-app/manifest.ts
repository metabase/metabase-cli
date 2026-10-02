import { resolve } from "node:path";

import { z } from "zod";

import { DATA_APP_SLUG_PATTERN, type DataAppUpdateInput } from "@metabase/client/domain/data-app";

import { parseYaml } from "../../runtime/yaml";
import { readTextFile } from "./files";

export const DATA_APP_MANIFEST_FILENAME = "data_app.yaml";

const DataAppManifest = z
  .object({
    version: z.number().int().positive().optional(),
    name: z.string().min(1),
    slug: z.string().regex(DATA_APP_SLUG_PATTERN, "must be dash-cased: a-z, 0-9 and single dashes"),
    description: z.string().nullable().optional(),
    path: z.string().min(1).default("./dist/index.js"),
    allowed_hosts: z.array(z.string()).optional(),
  })
  .loose();

export interface LoadedDataApp {
  slug: string;
  fields: DataAppUpdateInput & { display_name: string; bundle_path: string; bundle: string };
}

/** The app in `dir`: its `data_app.yaml` fields mapped to the API's, with the bundle its `path` names. */
export async function loadDataApp(dir: string): Promise<LoadedDataApp> {
  const manifestPath = resolve(dir, DATA_APP_MANIFEST_FILENAME);
  const manifest = parseYaml(await readTextFile(manifestPath), DataAppManifest, {
    source: manifestPath,
  });
  const bundle = await readTextFile(resolve(dir, manifest.path));
  return {
    slug: manifest.slug,
    fields: {
      display_name: manifest.name,
      bundle_path: manifest.path,
      bundle,
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      ...(manifest.version === undefined ? {} : { version: manifest.version }),
      ...(manifest.allowed_hosts === undefined ? {} : { allowed_hosts: manifest.allowed_hosts }),
    },
  };
}
