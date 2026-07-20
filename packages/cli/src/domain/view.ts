import type { ZodType } from "zod";

export interface ColumnDef<T> {
  key: keyof T & string;
  label?: string;
  width?: number;
  format?: (value: unknown) => string;
}

export type DeepPartial<T> =
  T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export interface ResourceView<T> {
  compactPick: ZodType<DeepPartial<T>>;
  tableColumns: ColumnDef<T>[];
}
