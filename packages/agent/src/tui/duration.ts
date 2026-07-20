const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SUB_SECOND_PRECISION = 10;

export function formatDuration(ms: number): string {
  const seconds = ms / MS_PER_SECOND;
  if (seconds < SUB_SECOND_PRECISION) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < SECONDS_PER_MINUTE) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}m ${Math.round(seconds % SECONDS_PER_MINUTE)}s`;
}
