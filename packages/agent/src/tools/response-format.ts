import { Type } from "typebox";

export const RESPONSE_FORMATS = ["concise", "detailed"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

export const responseFormatParam = Type.Optional(
  Type.Unsafe<ResponseFormat>({
    type: "string",
    enum: [...RESPONSE_FORMATS],
    description:
      "`concise` (default) projects each record to the fields an agent needs; `detailed` returns the full REST payload.",
  }),
);

export function resolveResponseFormat(value: ResponseFormat | undefined): ResponseFormat {
  return value ?? "concise";
}
