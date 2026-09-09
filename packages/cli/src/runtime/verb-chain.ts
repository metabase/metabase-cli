// Citty hands a leaf command raw args already stripped of the verbs that reached it, so the leaf
// knows only its own name. The entry still holds the whole argv and records the chain here, letting
// a runtime refusal name the command the way the user typed it.
let verbChain: string | null = null;

export function setVerbChain(chain: string | null): void {
  verbChain = chain;
}

export function readVerbChain(): string | null {
  return verbChain;
}
