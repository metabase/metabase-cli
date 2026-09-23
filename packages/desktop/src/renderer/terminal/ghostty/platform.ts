/**
 * `navigator.platform` is deprecated but is still the one field every browser
 * fills in with the machine's own platform rather than the site's; the
 * terminal's copy, paste and middle-click gestures differ by it.
 */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
