export type KeyScope = "global" | "composer";

export type KeyAction =
  | "new-session"
  | "open-palette"
  | "toggle-changes"
  | "open-settings"
  | "close-topmost"
  | "send"
  | "send-and-draft"
  | "newline"
  | "blur";

export type KeyPlatform = "apple" | "other";

export interface KeyChord {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
}

export interface KeyBinding {
  readonly action: KeyAction;
  readonly scope: KeyScope;
  readonly chord: KeyChord;
  readonly label: string;
}

function chord(key: string, mod: boolean, shift: boolean): KeyChord {
  return { key, mod, shift };
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { action: "new-session", scope: "global", chord: chord("n", true, false), label: "New session" },
  {
    action: "open-palette",
    scope: "global",
    chord: chord("k", true, false),
    label: "Search sessions and actions",
  },
  {
    action: "toggle-changes",
    scope: "global",
    chord: chord("d", true, true),
    label: "Show or hide the side panel",
  },
  { action: "open-settings", scope: "global", chord: chord(",", true, false), label: "Settings" },
  {
    action: "close-topmost",
    scope: "global",
    chord: chord("Escape", false, false),
    label: "Close the panel on top",
  },
  { action: "send", scope: "composer", chord: chord("Enter", false, false), label: "Send" },
  {
    action: "send-and-draft",
    scope: "composer",
    chord: chord("Enter", true, false),
    label: "Send and keep drafting",
  },
  {
    action: "newline",
    scope: "composer",
    chord: chord("Enter", false, true),
    label: "New line",
  },
  {
    action: "blur",
    scope: "composer",
    chord: chord("Escape", false, false),
    label: "Leave the composer",
  },
];

const APPLE_SEPARATOR = "";
const OTHER_SEPARATOR = "+";

export function chordName(input: KeyChord, platform: KeyPlatform): string {
  const apple = platform === "apple";
  const parts: string[] = [];
  if (input.mod) {
    parts.push(apple ? "⌘" : "Ctrl");
  }
  if (input.shift) {
    parts.push(apple ? "⇧" : "Shift");
  }
  parts.push(input.key.length === 1 ? input.key.toUpperCase() : input.key);
  return parts.join(apple ? APPLE_SEPARATOR : OTHER_SEPARATOR);
}

export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

function modifiersMatch(press: KeyPress, wanted: boolean, platform: KeyPlatform): boolean {
  const held = platform === "apple" ? press.metaKey : press.ctrlKey;
  const other = platform === "apple" ? press.ctrlKey : press.metaKey;
  return held === wanted && !other;
}

function sameKey(pressed: string, wanted: string): boolean {
  return pressed.length === 1 && wanted.length === 1
    ? pressed.toLowerCase() === wanted.toLowerCase()
    : pressed === wanted;
}

export function actionFor(
  press: KeyPress,
  scope: KeyScope,
  platform: KeyPlatform,
): KeyAction | null {
  if (press.altKey) {
    return null;
  }
  const match = KEY_BINDINGS.find(
    (binding) =>
      binding.scope === scope &&
      sameKey(press.key, binding.chord.key) &&
      modifiersMatch(press, binding.chord.mod, platform) &&
      binding.chord.shift === press.shiftKey,
  );
  return match?.action ?? null;
}
