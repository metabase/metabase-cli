import { z } from "zod";

const TerminalId = z.string().min(1);
const GridExtent = z.number().int().positive();

export const TerminalOpenRequest = z
  .object({ sessionId: z.string().min(1), cols: GridExtent, rows: GridExtent })
  .strict();
export type TerminalOpenRequest = z.infer<typeof TerminalOpenRequest>;

export const TerminalOpened = z.object({ terminalId: TerminalId }).strict();
export type TerminalOpened = z.infer<typeof TerminalOpened>;

export const TerminalRef = z.object({ terminalId: TerminalId }).strict();
export type TerminalRef = z.infer<typeof TerminalRef>;

export const TerminalInput = z.object({ terminalId: TerminalId, data: z.string() }).strict();
export type TerminalInput = z.infer<typeof TerminalInput>;

export const TerminalResize = z
  .object({ terminalId: TerminalId, cols: GridExtent, rows: GridExtent })
  .strict();
export type TerminalResize = z.infer<typeof TerminalResize>;

export const TerminalOutput = z.object({ terminalId: TerminalId, data: z.string() }).strict();
export type TerminalOutput = z.infer<typeof TerminalOutput>;

// `signal` is the one that ended the shell, or null when it exited on its own.
export const TerminalExit = z
  .object({
    terminalId: TerminalId,
    exitCode: z.number().int(),
    signal: z.number().int().nullable(),
  })
  .strict();
export type TerminalExit = z.infer<typeof TerminalExit>;
