import type { ArgsDef, ParsedArgs } from "citty";

// The parsed values of one flag set and nothing else: citty's `ParsedArgs` also carries the
// positionals and an open index signature, which a helper reading a shared flag set neither needs
// nor can be handed by a test.
export type FlagValues<A extends ArgsDef> = Pick<ParsedArgs<A>, keyof A>;
