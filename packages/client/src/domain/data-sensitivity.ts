import { z } from "zod";

import { FieldBaseType, FieldSemanticType } from "./field";

// Most severe first: the order is the precedence an automated classifier applies when several
// categories match one column. `null` is unscanned; `PUBLIC` is scanned and found clean.
export const DataSensitivityLabel = z.enum([
  "SEC_KEY",
  "SYS_TELEMETRY",
  "PHI",
  "BIO_GEN",
  "PCI_FIN",
  "SENS_PERS",
  "PII",
  "CORP_IP",
  "BIZ_CONF",
  "PUBLIC",
]);
export type DataSensitivityLabel = z.infer<typeof DataSensitivityLabel>;

export const DataSensitivityStatus = z.enum(["agree", "disagree", "new", "abstain", "dropped"]);
export type DataSensitivityStatus = z.infer<typeof DataSensitivityStatus>;

export const DataSensitivityConfidence = z.enum(["high", "medium", "low"]);
export type DataSensitivityConfidence = z.infer<typeof DataSensitivityConfidence>;

const DataSensitivityLabelState = z.enum(["human", "classifier", "unscanned"]);

const DataSensitivityUsage = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_tokens: z.number().int(),
  cache_creation_tokens: z.number().int(),
});

export const DataSensitivityCounts = z.object({
  fields: z.number().int(),
  agree: z.number().int(),
  disagree: z.number().int(),
  new: z.number().int(),
  abstain: z.number().int(),
  dropped: z.number().int(),
  semantic_changed: z.number().int(),
});
export type DataSensitivityCounts = z.infer<typeof DataSensitivityCounts>;

export const DataSensitivityFieldResult = z
  .object({
    field_id: z.number().int().positive(),
    name: z.string(),
    display_name: z.string().nullable(),
    base_type: FieldBaseType,
    current: z.object({
      data_sensitivity: DataSensitivityLabel.nullable(),
      human_set: z.boolean(),
      state: DataSensitivityLabelState,
      semantic_type: FieldSemanticType.nullable(),
    }),
    proposed: z.object({
      data_sensitivity: DataSensitivityLabel.nullable(),
      confidence: DataSensitivityConfidence.nullable(),
      semantic_type: FieldSemanticType.nullable(),
      reasoning: z.string().nullable(),
    }),
    status: DataSensitivityStatus,
    semantic_changed: z.boolean(),
  })
  .loose();
export type DataSensitivityFieldResult = z.infer<typeof DataSensitivityFieldResult>;

export const DataSensitivityTableResult = z
  .object({
    table_id: z.number().int().positive(),
    table_name: z.string(),
    schema: z.string().nullable(),
    database_id: z.number().int().positive(),
    model: z.string(),
    requests: z.number().int(),
    usage: DataSensitivityUsage,
    sample_error: z.string().nullable(),
    counts: DataSensitivityCounts,
    fields: z.array(DataSensitivityFieldResult),
  })
  .loose();
export type DataSensitivityTableResult = z.infer<typeof DataSensitivityTableResult>;

export const DataSensitivityTableError = z
  .object({
    table_id: z.number().int().positive(),
    table_name: z.string(),
    schema: z.string().nullable(),
    error: z.string(),
    error_code: z.string().nullable(),
  })
  .loose();
export type DataSensitivityTableError = z.infer<typeof DataSensitivityTableError>;

export type DataSensitivityTableEntry = DataSensitivityTableResult | DataSensitivityTableError;

export function isDataSensitivityTableError(
  entry: DataSensitivityTableEntry,
): entry is DataSensitivityTableError {
  return "error" in entry;
}

export const DataSensitivityDatabaseResult = z
  .object({
    database_id: z.number().int().positive(),
    schema: z.string().nullable(),
    tables: z.array(z.union([DataSensitivityTableResult, DataSensitivityTableError])),
    counts: DataSensitivityCounts,
    usage: DataSensitivityUsage,
    requests: z.number().int(),
    failed: z.number().int(),
  })
  .loose();
export type DataSensitivityDatabaseResult = z.infer<typeof DataSensitivityDatabaseResult>;
