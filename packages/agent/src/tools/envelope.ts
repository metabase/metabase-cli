const BYTES_PER_TOKEN_ESTIMATE = 4;
const RESPONSE_WARN_TOKENS = 10_000;
const RESPONSE_CAP_TOKENS = 20_000;

export const RESPONSE_WARN_BYTES = RESPONSE_WARN_TOKENS * BYTES_PER_TOKEN_ESTIMATE;
export const RESPONSE_CAP_BYTES = RESPONSE_CAP_TOKENS * BYTES_PER_TOKEN_ESTIMATE;

const ARRAY_BRACKET_BYTES = 2;
const ITEM_SEPARATOR_BYTES = 1;
const UNIT_OVERHEAD_BYTES = 32;

export type TruncationReason = "byte_cap" | "page_limit";

export interface EnvelopeTruncation {
  reason: TruncationReason;
  message: string;
}

export interface ListEnvelope<T> {
  data: T[];
  returned: number;
  total?: number | undefined;
  truncated?: EnvelopeTruncation | undefined;
}

export interface SteeringHint {
  noun: string;
  context?: string | undefined;
  narrowWith?: readonly string[] | undefined;
  pageWith?: string | undefined;
}

export interface BuildListOptions {
  steering: SteeringHint;
  total?: number | null | undefined;
  capBytes?: number;
}

export function formatSteeringMessage(displayTotal: number, steering: SteeringHint): string {
  const contextSuffix = steering.context !== undefined ? ` ${steering.context}` : "";
  const head = `${displayTotal} ${steering.noun}${contextSuffix}`;
  const clauses: string[] = [];
  if (steering.narrowWith !== undefined && steering.narrowWith.length > 0) {
    const params = steering.narrowWith.map(backtick).join(" or ");
    clauses.push(`narrow with ${params}`);
  }
  if (steering.pageWith !== undefined) {
    clauses.push(`page with ${backtick(steering.pageWith)}`);
  }
  if (clauses.length === 0) {
    return head;
  }
  return `${head} — ${clauses.join(", ")}`;
}

export function buildListEnvelope<T>(
  items: readonly T[],
  options: BuildListOptions,
): ListEnvelope<T> {
  const capBytes = options.capBytes ?? RESPONSE_CAP_BYTES;
  const kept: T[] = [];
  let bytes = ARRAY_BRACKET_BYTES;
  for (const item of items) {
    const separator = kept.length === 0 ? 0 : ITEM_SEPARATOR_BYTES;
    const itemBytes = jsonByteLength(item);
    if (kept.length > 0 && bytes + separator + itemBytes > capBytes) {
      break;
    }
    bytes += separator + itemBytes;
    kept.push(item);
  }

  const returned = kept.length;
  const total = options.total ?? undefined;
  const envelope: ListEnvelope<T> = { data: kept, returned };
  if (total !== undefined) {
    envelope.total = total;
  }

  const byteTruncated = returned < items.length;
  const pageTruncated = total !== undefined && total > returned;
  if (byteTruncated || pageTruncated) {
    const displayTotal = total ?? items.length;
    const reason: TruncationReason = byteTruncated ? "byte_cap" : "page_limit";
    envelope.truncated = { reason, message: formatSteeringMessage(displayTotal, options.steering) };
  }
  return envelope;
}

export interface BudgetUnit<T> {
  key: string;
  items: readonly T[];
}

export interface PackedUnit<T> {
  key: string;
  items: T[];
  offset: number;
  total: number;
}

export interface PackUnitsResult<T> {
  included: PackedUnit<T>[];
  omittedKeys: string[];
}

export interface PackUnitsOptions {
  capBytes?: number;
  startOffset?: number;
}

export function packUnits<T>(
  units: readonly BudgetUnit<T>[],
  options: PackUnitsOptions = {},
): PackUnitsResult<T> {
  const capBytes = options.capBytes ?? RESPONSE_CAP_BYTES;
  const startOffset = options.startOffset ?? 0;
  const included: PackedUnit<T>[] = [];
  const omittedKeys: string[] = [];
  let used = 0;
  let budgetExhausted = false;

  for (const [index, unit] of units.entries()) {
    if (budgetExhausted) {
      omittedKeys.push(unit.key);
      continue;
    }
    const offset = index === 0 ? startOffset : 0;
    const available = unit.items.slice(offset);
    const remainingBudget = capBytes - used - UNIT_OVERHEAD_BYTES;
    const { fit, bytes } = takeWhileFits(available, remainingBudget);

    if (fit.length === available.length) {
      included.push({ key: unit.key, items: fit, offset, total: unit.items.length });
      used += UNIT_OVERHEAD_BYTES + bytes;
      continue;
    }

    if (included.length === 0) {
      const sliced = fit.length > 0 ? fit : available.slice(0, 1);
      included.push({ key: unit.key, items: sliced, offset, total: unit.items.length });
    } else {
      omittedKeys.push(unit.key);
    }
    budgetExhausted = true;
  }

  return { included, omittedKeys };
}

interface FitResult<T> {
  fit: T[];
  bytes: number;
}

function takeWhileFits<T>(items: readonly T[], budget: number): FitResult<T> {
  const fit: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const separator = fit.length === 0 ? 0 : ITEM_SEPARATOR_BYTES;
    const itemBytes = jsonByteLength(item);
    if (bytes + separator + itemBytes > budget) {
      break;
    }
    bytes += separator + itemBytes;
    fit.push(item);
  }
  return { fit, bytes };
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function backtick(value: string): string {
  return `\`${value}\``;
}
