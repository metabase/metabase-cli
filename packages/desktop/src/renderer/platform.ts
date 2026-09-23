import type { KeyPlatform } from "./keybindings";

const APPLE_MARK = "Mac";

export function keyPlatform(): KeyPlatform {
  return navigator.userAgent.includes(APPLE_MARK) ? "apple" : "other";
}
