import type { ZodType } from "zod";

export interface ColumnDef<T> {
  key: keyof T & string;
  label?: string;
  width?: number;
  // A cell that depends on more than `key` (a location read by the row's type) reads the whole row.
  value?: (row: T) => unknown;
  format?: (value: unknown) => string;
}

type DeepPartial<T> =
  T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export interface ResourceView<T> {
  compactPick: ZodType<DeepPartial<T>>;
  tableColumns: ColumnDef<T>[];
}
