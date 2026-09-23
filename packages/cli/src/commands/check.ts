import { resolve } from "node:path";

import { validateSchema } from "@metabase/representations";
import { z } from "zod";

import { renderListWithExtras, writeText } from "../output/render";
import { listEnvelopeSchema } from "../output/types";
import type { ResourceView } from "../output/view";
import { windowList } from "../output/window";
import type { CommonContext } from "./context";
import { listFlags, outputFlags } from "./flags";
import { defineMetabaseCommand } from "./runtime";

const CheckFailure = z.object({
  file: z.string(),
  model: z.string().nullable(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
type CheckFailure = z.infer<typeof CheckFailure>;

interface CheckReport {
  readonly passed: number;
  readonly failures: CheckFailure[];
}

const checkFailureView: ResourceView<CheckFailure> = {
  compactPick: CheckFailure,
  tableColumns: [
    { key: "file", label: "File" },
    { key: "model", label: "Model" },
    { key: "errors", label: "Errors", format: (value) => JSON.stringify(value) },
  ],
};

const CheckEnvelope = listEnvelopeSchema(CheckFailure);

export function checkRepo(folder: string): CheckReport {
  const { results, passed } = validateSchema({ folder });
  const failures = results.flatMap((result) =>
    result.status === "ok"
      ? []
      : [{ file: result.file, model: result.model ?? null, errors: result.errors }],
  );
  return { passed, failures };
}

class CheckFailedError extends Error {
  constructor(failed: number) {
    super(`${failed} file(s) failed schema validation`);
    this.name = "CheckFailedError";
  }
}

function renderCheckReport(report: CheckReport, ctx: CommonContext): void {
  renderListWithExtras(
    windowList(report.failures, ctx.range),
    { passed: report.passed, failed: report.failures.length },
    checkFailureView,
    ctx,
  );
}

export function assertCheckPassed(report: CheckReport, ctx: CommonContext): void {
  if (report.failures.length === 0) {
    return;
  }
  renderCheckReport(report, ctx);
  throw new CheckFailedError(report.failures.length);
}

export default defineMetabaseCommand({
  meta: {
    name: "check",
    description: "Validate the representation YAML files in a folder against the schemas",
  },
  details:
    "Offline: validates every importable YAML file (collections/, databases/**/segments|measures/, transforms/, python_libraries/, ...) against the @metabase/representations JSON schemas. Lists only failing files; exits 1 when any file fails.",
  skills: [{ skill: "representations", purpose: "the format spec and the per-entity schemas" }],
  requires: null,
  args: {
    ...outputFlags,
    ...listFlags,
    folder: {
      type: "positional",
      description: "Repository folder to validate (default: current directory)",
      required: false,
    },
  },
  outputSchema: CheckEnvelope,
  examples: ["mb check", "mb check ./my-repo --json"],
  run({ args, ctx }) {
    const report = checkRepo(resolve(args.folder ?? "."));
    assertCheckPassed(report, ctx);
    if (ctx.format === "json") {
      renderCheckReport(report, ctx);
      return;
    }
    writeText(`OK: ${report.passed} file(s) passed schema validation`);
  },
});
