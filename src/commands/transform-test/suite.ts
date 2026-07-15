import { z } from "zod";

import { ConfigError } from "../../core/errors";
import { parseYaml } from "../../runtime/yaml";

import { readSqlFile, type AssertionDef, type Severity } from "./assert";
import { type InputPair, type TargetType } from "./subgraph";

const TargetTypeSchema = z.enum(["transform", "card"]);
const SeveritySchema = z.enum(["error", "warn"]);

const SuiteAssertion = z
  .object({
    name: z.string().min(1),
    sql: z.string().optional(),
    file: z.string().optional(),
    severity: SeveritySchema.optional(),
  })
  .strict();

const Suite = z
  .object({
    target: z.object({ type: TargetTypeSchema, id: z.number().int().positive() }).strict(),
    sources: z.array(z.number().int().positive()).optional(),
    inputs: z
      .array(z.object({ table: z.number().int().positive(), file: z.string() }).strict())
      .optional(),
    expected: z.string().optional(),
    ignore_columns: z.array(z.string()).optional(),
    assertions: z.array(SuiteAssertion).optional(),
  })
  .strict();

type Suite = z.infer<typeof Suite>;
type SuiteAssertion = z.infer<typeof SuiteAssertion>;

// The slice of SubgraphRunArgs a suite contributes.
export interface SuiteArgs {
  targetType: TargetType;
  target: number;
  sources: number[];
  inputs: InputPair[];
  expected?: string;
  ignoreColumns: string[];
  assertions: AssertionDef[];
}

async function resolveSuiteAssertion(entry: SuiteAssertion): Promise<AssertionDef> {
  const severity: Severity = entry.severity ?? "error";
  if (entry.sql !== undefined && entry.file === undefined) {
    return { name: entry.name, sql: entry.sql.trim(), severity };
  }
  if (entry.file !== undefined && entry.sql === undefined) {
    return {
      name: entry.name,
      sql: await readSqlFile(entry.file, "suite assertion file"),
      severity,
    };
  }
  throw new ConfigError(`Suite assertion '${entry.name}' must set exactly one of 'sql' or 'file'.`);
}

export async function parseSuite(yamlText: string, source: string): Promise<SuiteArgs> {
  const suite: Suite = parseYaml(yamlText, Suite, { source });
  const assertions = await Promise.all((suite.assertions ?? []).map(resolveSuiteAssertion));
  const args: SuiteArgs = {
    targetType: suite.target.type,
    target: suite.target.id,
    sources: suite.sources ?? [],
    inputs: (suite.inputs ?? []).map((row) => ({ tableId: row.table, path: row.file })),
    ignoreColumns: suite.ignore_columns ?? [],
    assertions,
  };
  if (suite.expected !== undefined) {
    args.expected = suite.expected;
  }
  return args;
}
