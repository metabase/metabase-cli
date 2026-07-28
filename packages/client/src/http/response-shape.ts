import type { ZodType } from "zod";

import { ResponseShapeError, ValidationError } from "../errors";
import { parseJson } from "../json";

import type { HttpMethod, ServerTagResolver } from "./transport";

export const NO_SERVER_TAG: ServerTagResolver = async () => null;

export interface ResponseContext {
  method: HttpMethod;
  url: string;
  status: number;
  getServerTag: ServerTagResolver;
}

// The server tag is resolved lazily: naming the version costs a request, and only a failed parse
// has anything to name it in.
export async function parseJsonResponse<T>(
  text: string,
  schema: ZodType<T>,
  context: ResponseContext,
): Promise<T> {
  try {
    return parseJson(text, schema, { source: context.url });
  } catch (error) {
    if (error instanceof ValidationError) {
      throw ResponseShapeError.fromZodIssues({
        kind: "zod",
        method: context.method,
        url: context.url,
        status: context.status,
        zodIssues: error.developerDetail.zodIssues,
        serverTag: await context.getServerTag(),
      });
    }
    throw error;
  }
}
