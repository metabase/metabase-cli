import { assertNever } from "../contracts/assert-never";
import type { WindowChrome } from "../contracts/window";

const LEADING_PROPERTY = "--chrome-leading";
const TRAILING_PROPERTY = "--chrome-trailing";
const NO_INSET = "0px";
// Chromium reports the part of the top strip the page keeps; the overlay is the rest of the width.
const OVERLAY_WIDTH = "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))";

interface ChromeInsets {
  readonly leading: string;
  readonly trailing: string;
}

function chromeInsets(chrome: WindowChrome): ChromeInsets {
  switch (chrome.kind) {
    case "traffic-lights": {
      return { leading: `${String(chrome.inset)}px`, trailing: NO_INSET };
    }
    case "controls-overlay": {
      return { leading: NO_INSET, trailing: OVERLAY_WIDTH };
    }
    default: {
      return assertNever(chrome);
    }
  }
}

export function applyChrome(chrome: WindowChrome): void {
  const insets = chromeInsets(chrome);
  const style = document.documentElement.style;
  style.setProperty(LEADING_PROPERTY, insets.leading);
  style.setProperty(TRAILING_PROPERTY, insets.trailing);
}
