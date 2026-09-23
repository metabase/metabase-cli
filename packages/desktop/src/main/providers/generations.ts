// A model's line and its release. A null tier is an unnamed line, which any newer release replaces.
export interface Generation {
  readonly tier: string | null;
  readonly version: readonly number[];
}

interface ReadRow<T> {
  readonly row: T;
  readonly generation: Generation | null;
}

// A release missing a minor number is its `.0`.
function compareVersions(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const step = (left[index] ?? 0) - (right[index] ?? 0);
    if (step !== 0) {
      return step;
    }
  }
  return 0;
}

function replaces(rival: Generation, own: Generation): boolean {
  return own.tier === null || rival.tier === own.tier;
}

// An agent lists every release it still serves; a person picks from the newest of each tier.
// Of two rows naming the same release the first stays, and a row the agent's ids cannot place stays.
export function newestPerTier<T>(
  rows: readonly T[],
  generationOf: (row: T) => Generation | null,
): T[] {
  const read: readonly ReadRow<T>[] = rows.map((row) => ({ row, generation: generationOf(row) }));
  const current = read.filter(({ generation: own }, index) => {
    if (own === null) {
      return true;
    }
    return read.every(({ generation: rival }, rivalIndex) => {
      if (rival === null || !replaces(rival, own)) {
        return true;
      }
      const order = compareVersions(rival.version, own.version);
      return order < 0 || (order === 0 && rivalIndex >= index);
    });
  });
  return current.map(({ row }) => row);
}
