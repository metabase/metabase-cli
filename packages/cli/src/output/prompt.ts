import {
  confirm as clackConfirm,
  isCancel,
  password as clackPassword,
  select as clackSelect,
  text as clackText,
  type SelectOptions,
} from "@clack/prompts";

import { createInterface } from "node:readline/promises";

import { AbortError, ConfigError } from "@metabase/client/errors";

import { warn } from "./notice";

type Validator = (value: string) => string | undefined;

interface TextPromptOptions {
  message: string;
  placeholder?: string;
  initialValue?: string;
  defaultValue?: string;
  validate?: Validator;
}

interface PasswordPromptOptions {
  message: string;
  mask?: string;
  validate?: Validator;
}

interface ConfirmPromptOptions {
  message: string;
  initialValue?: boolean;
}

interface LinePromptOptions {
  message: string;
  validate: (value: string) => string | null;
  signal: AbortSignal;
}

type SelectChoice<Value> = SelectOptions<Value>["options"][number];

interface SelectPromptOptions<Value> {
  message: string;
  choices: SelectChoice<Value>[];
  initialValue?: Value;
}

export function isPromptCancel(value: unknown): boolean {
  return isCancel(value);
}

export async function promptText(opts: TextPromptOptions): Promise<string> {
  requireTty(opts.message);
  const value = await clackText({
    message: opts.message,
    defaultValue: "",
    ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
    ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    ...(opts.defaultValue !== undefined && { defaultValue: opts.defaultValue }),
    ...(opts.validate !== undefined && { validate: opts.validate }),
  });
  if (isCancel(value)) {
    throw new AbortError();
  }
  return value;
}

export async function promptPassword(opts: PasswordPromptOptions): Promise<string> {
  requireTty(opts.message);
  const value = await clackPassword({
    message: opts.message,
    ...(opts.mask !== undefined && { mask: opts.mask }),
    ...(opts.validate !== undefined && { validate: opts.validate }),
  });
  if (isCancel(value)) {
    throw new AbortError();
  }
  return value;
}

export async function promptConfirm(opts: ConfirmPromptOptions): Promise<boolean> {
  requireTty(opts.message);
  const value = await clackConfirm({
    message: opts.message,
    ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
  });
  if (isCancel(value)) {
    throw new AbortError();
  }
  return value;
}

export async function promptSelect<Value>(opts: SelectPromptOptions<Value>): Promise<Value> {
  requireTty(opts.message);
  const value = await clackSelect<Value>({
    message: opts.message,
    options: opts.choices,
    ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
  });
  if (isCancel(value)) {
    throw new AbortError();
  }
  return value;
}

// A plain readline prompt rather than clack's: it can be withdrawn through `signal` while it waits,
// and a pasted line far wider than the terminal stays intact instead of being re-rendered per
// keystroke. Re-asks until `validate` accepts; rejects with AbortError once `signal` aborts or the
// user cancels.
export async function promptLine(opts: LinePromptOptions): Promise<string> {
  requireTty(opts.message);
  const cancel = new AbortController();
  const signal = AbortSignal.any([opts.signal, cancel.signal]);
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  // In raw mode Ctrl-C reaches readline as a keystroke rather than the process as SIGINT, and
  // Ctrl-D ends the input; both are the user walking away from the prompt.
  rl.on("SIGINT", () => cancel.abort());
  rl.on("close", () => cancel.abort());
  try {
    for (;;) {
      const answer = await rl.question(`${opts.message}\n> `, { signal });
      const problem = opts.validate(answer);
      if (problem === null) {
        return answer;
      }
      warn(problem);
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
    throw new AbortError();
  } finally {
    rl.close();
  }
}

function requireTty(prompt: string): void {
  if (!process.stdin.isTTY) {
    throw new ConfigError(`cannot prompt "${prompt}" — stdin is not a TTY`);
  }
}
