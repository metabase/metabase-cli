import { z } from "zod";

import type { Features } from "../version/features";

const FieldVisibilityType = z.enum(["details-only", "hidden", "normal", "retired", "sensitive"]);

const FieldValuesType = z.enum(["list", "search", "none", "auto-list"]);

// Semantic types that also derive from a base type. The server reads any `type/*` descendant back
// as a base type, and Snowflake syncs a GEOGRAPHY column as `type/SerializedJSON`, so both enums
// carry them.
const SEMANTIC_TYPES_WITH_BASE = [
  "type/AvatarURL",
  "type/Birthdate",
  "type/CancelationDate",
  "type/CancelationTime",
  "type/CancelationTimestamp",
  "type/City",
  "type/Comment",
  "type/Coordinate",
  "type/Cost",
  "type/Country",
  "type/CreationDate",
  "type/CreationTime",
  "type/CreationTimestamp",
  "type/Currency",
  "type/DeletionDate",
  "type/DeletionTime",
  "type/DeletionTimestamp",
  "type/Description",
  "type/Discount",
  "type/Duration",
  "type/Email",
  "type/GrossMargin",
  "type/ImageURL",
  "type/Income",
  "type/JoinDate",
  "type/JoinTime",
  "type/JoinTimestamp",
  "type/Latitude",
  "type/Longitude",
  "type/Name",
  "type/Percentage",
  "type/Price",
  "type/Quantity",
  "type/Score",
  "type/SerializedJSON",
  "type/Share",
  "type/State",
  "type/Title",
  "type/URL",
  "type/UpdatedDate",
  "type/UpdatedTime",
  "type/UpdatedTimestamp",
  "type/ZipCode",
] as const;

export const FieldBaseType = z.enum([
  "type/*",
  "type/field-values-unsupported",
  "type/fingerprint-unsupported",
  "type/Large",
  "type/Number",
  "type/Integer",
  "type/BigInteger",
  "type/Float",
  // The hive-like drivers (Spark SQL, Databricks) give a `double precision` query result column
  // this type, which the hierarchy never derives; a field stored with it reads back as `type/*`.
  "type/Double",
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
  ...SEMANTIC_TYPES_WITH_BASE,
]);
export type FieldBaseType = z.infer<typeof FieldBaseType>;

export const FieldSemanticType = z.enum([
  "Semantic/*",
  "Relation/*",
  ...SEMANTIC_TYPES_WITH_BASE,
  "type/Location",
  "type/Address",
  "type/IPAddress",
  "type/Category",
  "type/Enum",
  "type/Product",
  "type/Company",
  "type/Subscription",
  "type/Source",
  "type/CreationTemporal",
  "type/JoinTemporal",
  "type/CancelationTemporal",
  "type/DeletionTemporal",
  "type/UpdatedTemporal",
  "type/Structured",
  "type/JSON",
  "type/DruidJSON",
  "type/XML",
  "type/User",
  "type/Author",
  "type/Owner",
  "type/FK",
  "type/PK",
]);
export type FieldSemanticType = z.infer<typeof FieldSemanticType>;

// Most severe first, the precedence the server's classifier applies when several match.
export const FieldDataSensitivity = z.enum([
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
export type FieldDataSensitivity = z.infer<typeof FieldDataSensitivity>;

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

const FingerprintGlobal = z
  .object({
    "distinct-count": z.number().int().nullable().optional(),
    "nil%": z.number().nullable().optional(),
  })
  .loose();

const FingerprintNumber = z
  .object({
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    avg: z.number().nullable().optional(),
    q1: z.number().nullable().optional(),
    q3: z.number().nullable().optional(),
    sd: z.number().nullable().optional(),
  })
  .loose();

const FingerprintText = z
  .object({
    "average-length": z.number().nullable().optional(),
    "percent-json": z.number().nullable().optional(),
    "percent-url": z.number().nullable().optional(),
    "percent-email": z.number().nullable().optional(),
    "percent-state": z.number().nullable().optional(),
  })
  .loose();

const FingerprintDateTime = z
  .object({
    earliest: z.string().nullable().optional(),
    latest: z.string().nullable().optional(),
  })
  .loose();

// What Metabase measured of a column when it analysed it, over a sample of the table's first rows,
// each part only for the kinds of values it applies to. `distinct-count` is an estimate.
export const FieldFingerprint = z
  .object({
    global: FingerprintGlobal.optional(),
    type: z
      .object({
        "type/Number": FingerprintNumber.optional(),
        "type/Text": FingerprintText.optional(),
        "type/DateTime": FingerprintDateTime.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type FieldFingerprint = z.infer<typeof FieldFingerprint>;

export const Field = z
  .object({
    id: z.number().int(),
    table_id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    database_type: z.string().nullable().optional(),
    base_type: FieldBaseType,
    effective_type: FieldBaseType.nullable(),
    coercion_strategy: FieldCoercionStrategy.nullable(),
    semantic_type: FieldSemanticType.nullable(),
    fk_target_field_id: z.number().int().nullable(),
    // `null` on a key Metabase unfolded from a JSON column, which the database never declared.
    database_is_pk: z.boolean().nullable(),
    // The field a document database's nested field sits in.
    parent_id: z.number().int().nullable(),
    // The path to a key Metabase unfolded from a JSON column, `null` on any other field.
    nfc_path: z.array(z.string()).nullable(),
    has_field_values: FieldValuesType.nullable().optional(),
    visibility_type: FieldVisibilityType.nullable().optional(),
    active: z.boolean().optional(),
    position: z.number().int().optional(),
    // `null` until Metabase has analysed the column; left out by reads that do not hydrate it.
    fingerprint: FieldFingerprint.nullable().optional(),
    last_analyzed: z.string().nullable().optional(),
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

// A metadata read hydrates the field each foreign key points to as `target`. It is `null` on any
// other field, and on a foreign key whose target the caller cannot read.
export const FieldWithTarget = Field.extend({
  target: Field.nullable(),
});
export type FieldWithTarget = z.infer<typeof FieldWithTarget>;

// The shape the field endpoints answer on a server with the column: `data_sensitivity` is `null`
// when the field is unlabelled.
export const FieldWithDataSensitivity = Field.extend({
  data_sensitivity: FieldDataSensitivity.nullable(),
});
export type FieldWithDataSensitivity = z.infer<typeof FieldWithDataSensitivity>;

// A server without the column answers a plain `Field`, and it stays without the key: `null` already
// means "unlabelled", so it cannot also mean "this server cannot say".
export const FieldDetail = z.union([FieldWithDataSensitivity, Field]);
export type FieldDetail = z.infer<typeof FieldDetail>;

/** The shape `GET` and `PUT /api/field/{id}` answer on a server with `features`. */
export function fieldDetailSchema(features: Features): z.ZodType<FieldDetail> {
  return features.fieldDataSensitivity ? FieldWithDataSensitivity : Field;
}

/** Whether `field` came from a server that labels data sensitivity. */
export function hasDataSensitivity(field: FieldDetail): field is FieldWithDataSensitivity {
  return (
    "data_sensitivity" in field &&
    FieldWithDataSensitivity.shape.data_sensitivity.safeParse(field.data_sensitivity).success
  );
}

export const FieldWithDataSensitivityCompact = FieldCompact.extend({
  data_sensitivity: FieldDataSensitivity.nullable(),
}).strip();
export type FieldWithDataSensitivityCompact = z.infer<typeof FieldWithDataSensitivityCompact>;

const NonBlankNullable = z.string().min(1).nullable();

export const FieldUpdateInput = z
  .object({
    display_name: NonBlankNullable.optional(),
    description: NonBlankNullable.optional(),
    caveats: NonBlankNullable.optional(),
    points_of_interest: NonBlankNullable.optional(),
    semantic_type: FieldSemanticType.nullable().optional(),
    coercion_strategy: FieldCoercionStrategy.nullable().optional(),
    data_sensitivity: FieldDataSensitivity.nullable().optional(),
    fk_target_field_id: z.number().int().positive().nullable().optional(),
    visibility_type: FieldVisibilityType.nullable().optional(),
    has_field_values: FieldValuesType.nullable().optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    nfc_path: z.array(z.string().min(1)).nullable().optional(),
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

// Each match is `[value]` when both fields resolve to the same field once FKs are followed, else
// `[value, label]`, the label being the display value for a field with custom display values; the
// cells are whatever the warehouse column holds.
export const FieldSearchMatches = z.array(
  z.union([z.tuple([z.unknown()]), z.tuple([z.unknown(), z.unknown()])]),
);
export type FieldSearchMatches = z.infer<typeof FieldSearchMatches>;

const FieldRemappedPair = z.tuple([z.unknown(), z.unknown()]);

// The server deduplicates the columns it selects, so when the field (after following an FK) and the
// remapped field are one column the row carries it once, and that value is its own remapping.
const FieldRemappedSingle = z
  .tuple([z.unknown()])
  .transform(([value]): z.infer<typeof FieldRemappedPair> => [value, value]);

// `[value, remapped]` for the one row whose field equals the value asked about.
export const FieldRemappedValue = z.union([FieldRemappedPair, FieldRemappedSingle]);
export type FieldRemappedValue = z.infer<typeof FieldRemappedValue>;

// A server that runs the lookup with display remapping on appends a display column after the one or
// two columns asked for, for each of them that has one, so the row has one to four cells. The first
// two are the pair unless the two ids name one field, whose value is then its own remapping.
const FieldRemappedRowWireV59 = z.array(z.unknown()).min(1);

function firstTwoCells(row: unknown[]): FieldRemappedValue {
  const [value, second] = row;
  return row.length === 1 ? [value, value] : [value, second];
}

function valueTwice(row: unknown[]): FieldRemappedValue {
  const [value] = row;
  return [value, value];
}

/**
 * The row `GET /api/field/{id}/remapping/{remapped-id}` answers on a server with `features`, read as
 * `FieldRemappedValue`. `sameField` says the two ids name one field.
 */
export function fieldRemappedValueSchema(
  features: Features,
  sameField: boolean,
): z.ZodType<FieldRemappedValue> {
  if (!features.fieldRemappingAppendsDisplayColumns) {
    return FieldRemappedValue;
  }
  return FieldRemappedRowWireV59.transform(sameField ? valueTwice : firstTwoCells);
}

export const FieldSummary = z.object({
  field_id: z.number().int(),
  count: z.number().int(),
  distincts: z.number().int(),
});
export type FieldSummary = z.infer<typeof FieldSummary>;
