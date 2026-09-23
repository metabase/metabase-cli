export interface TextSegment {
  readonly text: string;
  readonly code: boolean;
}

const BACKTICK = "`";

// Messages from main name a command between backticks, the way the CLI and the agents write it;
// the page sets those stretches as code instead of printing the backticks.
export function inlineCodeSegments(message: string): readonly TextSegment[] {
  const parts = message.split(BACKTICK);
  if (parts.length % 2 === 0) {
    return [{ text: message, code: false }];
  }
  return parts
    .map((text, index) => ({ text, code: index % 2 === 1 }))
    .filter((segment) => segment.text.length > 0);
}
