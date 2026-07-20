import { toMetabaseError } from "@metabase/cli/errors";
import type { ListEnvelope } from "./envelope";
import { type DatasetPayload, type PayloadSection, payloadText, type ToolPayload } from "./payload";
import type { ResponseFormat } from "./response-format";
import { toTeachingError } from "./teaching-error";

interface ToolTextContent {
  type: "text";
  text: string;
}

/**
 * `content` is the model's entire view of the result; `details` never reaches the provider and
 * exists so the TUI can render the same facts without parsing the model-facing text.
 */
export interface TextToolResult {
  content: ToolTextContent[];
  details: ToolPayload;
}

function toResult(details: ToolPayload): TextToolResult {
  return { content: [{ type: "text", text: payloadText(details) }], details };
}

export function jsonResult(label: string, value: unknown): TextToolResult {
  return toResult({ kind: "json", label, value });
}

/** A write's answer is one entity, and `noun` is what makes its id an address rather than a number. */
export function entityResult(noun: string, label: string, value: unknown): TextToolResult {
  return toResult({ kind: "json", label, noun, value });
}

/**
 * `detailed` items are whole REST payloads — dozens of keys, nested objects — so they stay JSON.
 * Only the compact projection is regular enough to tabulate.
 */
export function listResult(
  noun: string,
  envelope: ListEnvelope<unknown>,
  format: ResponseFormat,
): TextToolResult {
  if (format === "detailed") {
    return jsonResult(`${envelope.returned} ${noun}`, envelope);
  }
  return toResult({ kind: "list", noun, envelope });
}

export function sectionsResult(
  noun: string,
  sections: PayloadSection[],
  notices: string[],
): TextToolResult {
  return toResult({ kind: "sections", noun, sections, notices });
}

export function datasetResult(payload: Omit<DatasetPayload, "kind">): TextToolResult {
  return toResult({ kind: "dataset", ...payload });
}

export async function guardTool<T>(fn: () => Promise<T>, bodyFix = ""): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toTeachingError(error, bodyFix);
  }
}

export function errorMessageOf(error: unknown): string {
  return toMetabaseError(error).userMessage;
}
