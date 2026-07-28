# Metadata — full reference

The semantic-type catalog, the `has_field_values` / `visibility_type` value tables, and the exact writable-key lists for `field update` and `table update`. All values are strings in JSON (`"type/Currency"`). Unknown values are rejected — a new server type surfaces as a parse error, a deliberate signal.

## Semantic types by base type

Assign the one that matches the column's meaning. Grouped by the base type it belongs on; assigning a numeric semantic type to a text column is legal but only affects formatting, not behavior.

**Relations (any type)**
`type/PK` (entity key) · `type/FK` (needs `fk_target_field_id`)

**Text — categorical & descriptive**
`type/Category` · `type/Enum` · `type/Name` · `type/Title` · `type/Description` · `type/Comment` · `type/Source`

**Text — communication & links**
`type/Email` · `type/URL` · `type/ImageURL` · `type/AvatarURL` · `type/IPAddress`

**Text — business entities**
`type/User` · `type/Author` · `type/Owner` · `type/Product` · `type/Company` · `type/Subscription`

**Location** (text unless noted)
`type/City` · `type/State` · `type/Country` · `type/ZipCode` · `type/Latitude` (numeric) · `type/Longitude` (numeric) · `type/Coordinate` (numeric) · `type/Address`

**Numeric — quantities & ratios**
`type/Quantity` · `type/Score` · `type/Percentage` · `type/Share` · `type/Duration`

**Numeric — money**
`type/Currency` · `type/Price` · `type/Income` · `type/Cost` · `type/Discount` · `type/GrossMargin`

**Temporal** (each has `…Timestamp` / `…Time` / `…Date` variants)
`type/CreationTimestamp` · `type/UpdatedTimestamp` · `type/JoinTimestamp` · `type/CancelationTimestamp` · `type/DeletionTimestamp` · `type/Birthdate`

**Structured**
`type/Structured` · `type/SerializedJSON` · `type/XML`

Location maps need clean inputs: lat/long must be numeric; `City`/`State`/`Country` must hold consistent, correctly-spelled values (and usually a scanned value set) to render region maps.

## `has_field_values`

Controls the filter widget and whether Metabase stores a distinct-value set (scanned from the column).

| Value       | Widget      | Value set stored?                                 | Use for                                          |
| ----------- | ----------- | ------------------------------------------------- | ------------------------------------------------ |
| `list`      | dropdown    | yes (kept even if cardinality grows)              | low-cardinality columns you want as a picker     |
| `auto-list` | dropdown    | yes (sync-assigned; reverts if too many distinct) | the default Metabase picks automatically         |
| `search`    | search box  | no                                                | high-cardinality text (names, emails)            |
| `none`      | plain input | no                                                | free-form values                                 |
| `null`      | inferred    | —                                                 | let sync decide (you rarely set this explicitly) |

A `list`/`auto-list` column's dropdown is refreshed by `mb db rescan-values <db-id>`.

## `visibility_type` (field)

| Value          | Effect                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `normal`       | default — visible everywhere                                                                                    |
| `details-only` | hidden in table views; shown in the single-record detail view (long text / JSON blobs)                          |
| `hidden`       | removed from the query builder and data reference — **UI only, not access control** (native SQL still reads it) |
| `sensitive`    | **queries touching the field error** — stronger than hidden                                                     |
| `retired`      | auto-set for dropped columns; **queries error**                                                                 |

## `visibility_type` (table)

`hidden` · `technical` · `cruft` — all hide the table from the query builder and data reference (degrees of "don't show this"). `null` is normal.

## Writable keys

Everything else on a field/table (physical `name`, `base_type`, `effective_type`, `active`, ids, timestamps) is read-only, set by sync.

**`PUT /api/field/:id` (`mb field update`)**
`display_name` · `description` · `caveats` · `points_of_interest` · `semantic_type` · `coercion_strategy` · `fk_target_field_id` · `visibility_type` · `has_field_values` · `settings` · `nfc_path` · `json_unfolding`

**`PUT /api/table/:id` (`mb table update`)**
`display_name` · `description` · `visibility_type` · `field_order` (`database` / `alphabetical` / `custom` / `smart`) · `entity_type` · `caveats` · `points_of_interest` · `show_in_getting_started` · `owner_user_id` / `owner_email` (ownership) · `data_layer` / `data_authority` / `data_source` (data-governance tiers) · `collection_id` (v62+)

## Coercion strategies (common)

Cast a `base_type` to a more useful `effective_type`. The value must be compatible with the column's base type and is driver-dependent (an unsupported one 400s at update).

- Epoch numbers → datetime: `Coercion/UNIXSeconds->DateTime`, `Coercion/UNIXMilliSeconds->DateTime`, `Coercion/UNIXMicroSeconds->DateTime`, `Coercion/UNIXNanoSeconds->DateTime`
- ISO-8601 strings → temporal: `Coercion/ISO8601->DateTime`, `Coercion/ISO8601->Date`, `Coercion/ISO8601->Time`
- Numeric strings → number: `Coercion/String->Integer`, `Coercion/String->Float`
- Narrowing: `Coercion/Float->Integer`, `Coercion/DateTime->Date`
