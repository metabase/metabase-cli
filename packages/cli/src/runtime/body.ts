import type { ZodType } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { DEFAULT_FLAG_NAME, givenValue, readInput, type InputSources } from "./input";

interface BodySources extends InputSources {
  source?: string | undefined;
}

export async function readBody<T>(sources: BodySources, schema: ZodType<T>): Promise<T> {
  assertSingleSource(sources);
  const raw = await readInput(sources);
  return parseJson(raw, schema, { source: sources.source ?? "request body" });
}

function assertSingleSource(sources: BodySources): void {
  const provided: string[] = [];
  if (givenValue(sources.flag) !== null) {
    provided.push(DEFAULT_FLAG_NAME);
  }
  if (givenValue(sources.file) !== null) {
    provided.push("--file");
  }
  if (givenValue(sources.positional) !== null) {
    provided.push("positional");
  }
  if (provided.length > 1) {
    throw new ConfigError(`multiple body sources given (${provided.join(", ")}); pass exactly one`);
  }
}
