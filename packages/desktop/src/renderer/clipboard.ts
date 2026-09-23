export interface CopyIdle {
  readonly kind: "idle";
}

export interface CopyDone {
  readonly kind: "copied";
}

export interface CopyFailed {
  readonly kind: "failed";
  readonly message: string;
}

export type CopyState = CopyIdle | CopyDone | CopyFailed;

export const COPY_IDLE: CopyIdle = { kind: "idle" };

export const COPIED_RESET_MS = 1500;

export async function copyText(text: string): Promise<CopyState> {
  try {
    await navigator.clipboard.writeText(text);
    return { kind: "copied" };
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
