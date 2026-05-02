export type Format = "json" | "text";
export type Detail = "compact" | "full" | "fields";

export const DEFAULT_MAX_BYTES = 65536;

export interface TruncationInfo {
  reason: "max_bytes";
  bytes: number;
}

export interface ListEnvelope<T> {
  data: T[];
  returned: number;
  total?: number;
  limit?: number;
  truncated?: TruncationInfo;
}

export interface RenderOptions {
  format: Format;
  detail: Detail;
  fields: string[] | undefined;
  maxBytes: number;
}
