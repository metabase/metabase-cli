export interface ScrollMetrics {
  readonly offset: number;
  readonly viewport: number;
  readonly content: number;
}

// Wide enough to cover half a screen and reading history re-arms following.
export const FOLLOW_BAND_PX = 40;

export function gapToEnd(metrics: ScrollMetrics): number {
  return metrics.content - metrics.offset - metrics.viewport;
}

export function atEnd(metrics: ScrollMetrics): boolean {
  return gapToEnd(metrics) <= FOLLOW_BAND_PX;
}

// Content that does not fill the viewport cannot be scrolled away from, so a gesture over it must
// not stop the timeline following: nothing would ever arm it again.
export function canScroll(metrics: ScrollMetrics): boolean {
  return metrics.content > metrics.viewport;
}
