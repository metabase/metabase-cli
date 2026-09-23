import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { EidTranslateResult } from "@metabase/client/domain/eid-translation";

import type { DiffFile } from "../../contracts/changes";
import type { ContentItem, ContentValidation, SessionContent } from "../../contracts/metabase";
import type { MetabaseCli } from "../cli/runner";
import { gitText, type Git } from "../git/service";
import type { ChangedFiles } from "../sessions/changes";

import {
  contentEntity,
  contentLink,
  isContentYaml,
  translatedId,
  translationRequest,
} from "./links";
import type { ContentEntity, MetabaseSite } from "./links";
import { lastRunOf } from "./transforms";

// Metabase reads content from these directories of the repository and no others; `mb validate`
// walks the same ones.
const CONTENT_ROOTS = ["collections/", "databases/", "transforms/", "python_libraries/"] as const;

const ValidationReport = z.object({
  results: z.array(
    z.object({
      file: z.string(),
      ok: z.boolean(),
      errors: z.array(z.object({ path: z.string(), message: z.string().min(1) })),
    }),
  ),
});
type ValidationReport = z.infer<typeof ValidationReport>;

interface ContentDeps {
  readonly git: Git;
  readonly cli: MetabaseCli;
  readonly log: (message: string) => void;
}

// `site` is null when the app is not signed in to an instance, and then nothing is asked of
// Metabase.
interface ContentRead {
  readonly cwd: string;
  readonly changed: ChangedFiles;
  readonly site: MetabaseSite | null;
}

interface ReadFile {
  readonly file: DiffFile;
  readonly entity: ContentEntity | null;
}

function isContentFile(file: DiffFile): boolean {
  return isContentYaml(file.path) && CONTENT_ROOTS.some((root) => file.path.startsWith(root));
}

async function fileText(deps: ContentDeps, read: ContentRead, file: DiffFile): Promise<string> {
  if (file.change === "deleted") {
    return gitText(await deps.git.read(read.cwd, ["show", `${read.changed.from}:${file.path}`]));
  }
  return readFile(join(read.cwd, file.path), "utf8");
}

function validationOf(report: ValidationReport, path: string): ContentValidation {
  const result = report.results.find((entry) => entry.file === path);
  if (result === undefined) {
    return { kind: "unchecked", reason: `mb validate did not report on ${path}.` };
  }
  const [first, ...rest] = result.errors;
  if (result.ok || first === undefined) {
    return { kind: "valid" };
  }
  const issues = [first, ...rest].map((issue) => ({ pointer: issue.path, message: issue.message }));
  return { kind: "invalid", issues };
}

async function validations(
  deps: ContentDeps,
  cwd: string,
  paths: readonly string[],
): Promise<(path: string) => ContentValidation> {
  if (paths.length === 0) {
    return () => ({ kind: "valid" });
  }
  const checked = await deps.cli.report(cwd, ["validate", ...paths], ValidationReport);
  if (checked.kind === "failed") {
    const reason = checked.message;
    return () => ({ kind: "unchecked", reason });
  }
  return (path) => validationOf(checked.value, path);
}

// A translation that fails only costs the links, so it is logged and the list still shows.
async function translate(
  deps: ContentDeps,
  cwd: string,
  entities: readonly ContentEntity[],
): Promise<EidTranslateResult | null> {
  const request = translationRequest(entities);
  if (Object.keys(request.entity_ids).length === 0) {
    return null;
  }
  const body = JSON.stringify(request);
  const translated = await deps.cli.run(cwd, ["eid", "--body", body], EidTranslateResult);
  if (translated.kind === "failed") {
    deps.log(`content: the session's content has no links: ${translated.message}`);
    return null;
  }
  return translated.value;
}

interface Held {
  readonly url: string | null;
  readonly transformId: number | null;
}

function heldBy(
  site: MetabaseSite | null,
  translated: EidTranslateResult | null,
  read: ReadFile,
): Held {
  const entity = read.entity;
  if (site === null || translated === null || entity === null || read.file.change === "deleted") {
    return { url: null, transformId: null };
  }
  const link = contentLink(site, entity, translated);
  const transformId =
    entity.kind === "transform" && entity.entityId !== null
      ? translatedId(translated, entity.entityId)
      : null;
  return { url: link === null ? null : link.url, transformId };
}

// Every YAML the session changed under the content roots, as the object it holds, whether the
// representation schema takes it, and, once Metabase holds it, where it opens and how a transform
// last ran.
export async function readSessionContent(
  deps: ContentDeps,
  read: ContentRead,
): Promise<SessionContent> {
  const files = read.changed.files.filter(isContentFile);
  const readFiles: ReadFile[] = await Promise.all(
    files.map(async (file) => ({ file, entity: contentEntity(await fileText(deps, read, file)) })),
  );
  const live = readFiles.filter((entry) => entry.file.change !== "deleted");
  const validation = await validations(
    deps,
    read.cwd,
    live.map((entry) => entry.file.path),
  );
  const translated =
    read.site === null
      ? null
      : await translate(
          deps,
          read.cwd,
          live.map((entry) => entry.entity).filter((entity) => entity !== null),
        );
  const items: ContentItem[] = await Promise.all(
    readFiles.map(async (entry) => {
      const held = heldBy(read.site, translated, entry);
      const transformId = held.transformId;
      return {
        path: entry.file.path,
        change: entry.file.change,
        entity: entry.entity === null ? null : { kind: entry.entity.kind, name: entry.entity.name },
        validation: entry.file.change === "deleted" ? null : validation(entry.file.path),
        url: held.url,
        transform:
          transformId === null
            ? null
            : { id: transformId, lastRun: await lastRunOf(deps.cli, read.cwd, transformId) },
      };
    }),
  );
  return { items };
}
