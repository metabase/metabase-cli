import {
  confirm as clackConfirm,
  isCancel,
  password as clackPassword,
  select as clackSelect,
  text as clackText,
  type SelectOptions,
} from "@clack/prompts";

import { AbortError, ConfigError } from "../core/errors";

type Validator = (value: string) => string | undefined;

export interface TextPromptOptions {
  message: string;
  placeholder?: string;
  initialValue?: string;
  defaultValue?: string;
  validate?: Validator;
}

export interface PasswordPromptOptions {
  message: string;
  mask?: string;
  validate?: Validator;
}

export interface ConfirmPromptOptions {
  message: string;
  initialValue?: boolean;
}

export type SelectChoice<Value> = SelectOptions<Value>["options"][number];

export interface SelectPromptOptions<Value> {
  message: string;
  choices: SelectChoice<Value>[];
  initialValue?: Value;
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

function requireTty(prompt: string): void {
  if (!process.stdin.isTTY) {
    throw new ConfigError(`cannot prompt "${prompt}" — stdin is not a TTY`);
  }
}
