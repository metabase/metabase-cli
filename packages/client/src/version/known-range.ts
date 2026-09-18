// The majors this client was built and tested against. A server above `max` is read as `max + 1`:
// its additions pass through the loose schemas, and a shape it changed fails loudly instead of
// being guessed at. A server below `min` keeps its real major so every feature it lacks is refused
// by name.
export const KNOWN_RANGE = { min: 58, max: 63 } as const;
