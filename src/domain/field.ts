import { z } from "zod";

import type { ResourceView } from "./view";

const FieldVisibilityType = z.enum(["details-only", "hidden", "normal", "retired", "sensitive"]);

const FieldValuesType = z.enum(["list", "search", "none", "auto-list"]);

export const FieldBaseType = z.enum([
  "type/*",
  "type/field-values-unsupported",
  "type/fingerprint-unsupported",
  "type/Large",
  "type/Number",
  "type/Integer",
  "type/BigInteger",
  "type/Float",
  "type/Decimal",
  "type/Text",
  "type/UUID",
  "type/OracleCLOB",
  "type/Temporal",
  "type/HasDate",
  "type/HasTime",
  "type/Date",
  "type/Time",
  "type/TimeWithTZ",
  "type/TimeWithLocalTZ",
  "type/TimeWithZoneOffset",
  "type/DateTime",
  "type/DateTimeWithTZ",
  "type/DateTimeWithLocalTZ",
  "type/DateTimeWithZoneOffset",
  "type/DateTimeWithZoneID",
  "type/Instant",
  "type/Interval",
  "type/Boolean",
  "type/DruidHyperUnique",
  "type/SnowflakeVariant",
  "type/TextLike",
  "type/MongoBSONID",
  "type/MongoBinData",
  "type/MySQLEnum",
  "type/PostgresEnum",
  "type/PostgresBitString",
  "type/IPAddress",
  "type/Collection",
  "type/Dictionary",
  "type/Array",
  "type/Structured",
  "type/JSON",
  "type/DruidJSON",
  "type/XML",
]);
export type FieldBaseType = z.infer<typeof FieldBaseType>;

export const FieldSemanticType = z.enum([
  "type/Quantity",
  "type/Share",
  "type/Percentage",
  "type/Currency",
  "type/Income",
  "type/Discount",
  "type/Price",
  "type/GrossMargin",
  "type/Cost",
  "type/Score",
  "type/Duration",
  "type/Location",
  "type/Coordinate",
  "type/Latitude",
  "type/Longitude",
  "type/Address",
  "type/City",
  "type/State",
  "type/Country",
  "type/ZipCode",
  "type/URL",
  "type/ImageURL",
  "type/AvatarURL",
  "type/Email",
  "type/Description",
  "type/Comment",
  "type/IPAddress",
  "type/Category",
  "type/Enum",
  "type/Name",
  "type/Title",
  "type/Product",
  "type/Company",
  "type/Subscription",
  "type/Source",
  "type/CreationTemporal",
  "type/CreationTimestamp",
  "type/CreationTime",
  "type/CreationDate",
  "type/JoinTemporal",
  "type/JoinTimestamp",
  "type/JoinTime",
  "type/JoinDate",
  "type/CancelationTemporal",
  "type/CancelationTimestamp",
  "type/CancelationTime",
  "type/CancelationDate",
  "type/DeletionTemporal",
  "type/DeletionTimestamp",
  "type/DeletionTime",
  "type/DeletionDate",
  "type/UpdatedTemporal",
  "type/UpdatedTimestamp",
  "type/UpdatedTime",
  "type/UpdatedDate",
  "type/Birthdate",
  "type/Structured",
  "type/SerializedJSON",
  "type/XML",
  "type/User",
  "type/Author",
  "type/Owner",
  "type/FK",
  "type/PK",
]);
export type FieldSemanticType = z.infer<typeof FieldSemanticType>;

export const FieldCoercionStrategy = z.enum([
  "Coercion/String->Temporal",
  "Coercion/ISO8601->Temporal",
  "Coercion/ISO8601->DateTime",
  "Coercion/ISO8601->Time",
  "Coercion/ISO8601->Date",
  "Coercion/YYYYMMDDHHMMSSString->Temporal",
  "Coercion/Bytes->Temporal",
  "Coercion/YYYYMMDDHHMMSSBytes->Temporal",
  "Coercion/ISO8601Bytes->Temporal",
  "Coercion/Number->Temporal",
  "Coercion/UNIXTime->Temporal",
  "Coercion/UNIXSeconds->DateTime",
  "Coercion/UNIXMilliSeconds->DateTime",
  "Coercion/UNIXMicroSeconds->DateTime",
  "Coercion/UNIXNanoSeconds->DateTime",
  "Coercion/Temporal->Temporal",
  "Coercion/DateTime->Date",
  "Coercion/String->Number",
  "Coercion/String->Float",
  "Coercion/String->Integer",
  "Coercion/Float->Integer",
]);
export type FieldCoercionStrategy = z.infer<typeof FieldCoercionStrategy>;

export const Field = z
  .object({
    id: z.number().int(),
    table_id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    database_type: z.string().nullable().optional(),
    base_type: FieldBaseType,
    semantic_type: FieldSemanticType.nullable(),
    fk_target_field_id: z.number().int().nullable(),
    has_field_values: FieldValuesType.nullable().optional(),
    visibility_type: FieldVisibilityType.nullable().optional(),
    active: z.boolean().optional(),
    position: z.number().int().optional(),
  })
  .loose();
export type Field = z.infer<typeof Field>;

export const FieldCompact = Field.pick({
  id: true,
  name: true,
  display_name: true,
  description: true,
  table_id: true,
  base_type: true,
  semantic_type: true,
  fk_target_field_id: true,
}).strip();
export type FieldCompact = z.infer<typeof FieldCompact>;

export const fieldView: ResourceView<Field> = {
  compactPick: FieldCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "display_name", label: "Display Name" },
    { key: "base_type", label: "Base Type" },
    { key: "semantic_type", label: "Semantic Type" },
    { key: "fk_target_field_id", label: "FK Target" },
    { key: "description", label: "Description" },
  ],
};

const NonBlankNullable = z.string().min(1).nullable();

export const FieldUpdateInput = z
  .object({
    display_name: z.string().min(1).optional(),
    description: NonBlankNullable.optional(),
    caveats: NonBlankNullable.optional(),
    points_of_interest: NonBlankNullable.optional(),
    semantic_type: FieldSemanticType.nullable().optional(),
    coercion_strategy: FieldCoercionStrategy.nullable().optional(),
    fk_target_field_id: z.number().int().positive().nullable().optional(),
    visibility_type: FieldVisibilityType.optional(),
    has_field_values: FieldValuesType.optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    nfc_path: z.array(z.string()).nullable().optional(),
    json_unfolding: z.boolean().nullable().optional(),
  })
  .loose();
export type FieldUpdateInput = z.infer<typeof FieldUpdateInput>;

export const FieldValues = z
  .object({
    values: z.array(z.array(z.unknown())),
    field_id: z.number().int().optional(),
    has_more_values: z.boolean().optional(),
    has_field_values: FieldValuesType.optional(),
  })
  .loose();
export type FieldValues = z.infer<typeof FieldValues>;

export const FieldValuesCompact = FieldValues.pick({
  values: true,
  field_id: true,
  has_more_values: true,
}).strip();
export type FieldValuesCompact = z.infer<typeof FieldValuesCompact>;

export const fieldValuesView: ResourceView<FieldValues> = {
  compactPick: FieldValuesCompact,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "has_more_values", label: "Has More" },
    { key: "values", label: "Values" },
  ],
};

export const FieldSummaryRaw = z.tuple([
  z.tuple([z.literal("count"), z.number().int()]),
  z.tuple([z.literal("distincts"), z.number().int()]),
]);
export type FieldSummaryRaw = z.infer<typeof FieldSummaryRaw>;

export const FieldSummary = z.object({
  field_id: z.number().int(),
  count: z.number().int(),
  distincts: z.number().int(),
});
export type FieldSummary = z.infer<typeof FieldSummary>;

export const fieldSummaryView: ResourceView<FieldSummary> = {
  compactPick: FieldSummary,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "count", label: "Count" },
    { key: "distincts", label: "Distinct" },
  ],
};
