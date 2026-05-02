import type { ZodType } from "zod";

export interface ColumnDef<T> {
  key: keyof T & string;
  label?: string;
  width?: number;
  format?: (value: unknown) => string;
}

export interface ResourceView<T> {
  compactPick: ZodType<Partial<T>>;
  tableColumns: ColumnDef<T>[];
}
