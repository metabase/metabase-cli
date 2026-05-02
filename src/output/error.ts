import { toMetabaseError } from "../core/errors";

export function reportError(error: unknown): void {
  const handled = toMetabaseError(error);
  process.stderr.write(handled.userMessage + "\n");
  if (process.env["METABASE_VERBOSE"] === "1" && handled.developerDetail !== null) {
    process.stderr.write(JSON.stringify(handled.developerDetail, null, 2) + "\n");
  }
  process.exitCode = handled.exitCode;
}
